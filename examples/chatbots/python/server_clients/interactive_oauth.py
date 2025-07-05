"""
Interactive OAuth server client for MCP servers requiring OAuth authentication.

This client handles the complete OAuth flow including browser-based authorization.
"""

import logging
import threading
import time
import webbrowser
from datetime import timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Optional
from urllib.parse import parse_qs, urlparse

import boto3
from botocore.exceptions import ClientError

from mcp.client.auth import OAuthClientProvider, TokenStorage
from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from mcp.shared.auth import OAuthClientInformationFull, OAuthClientMetadata, OAuthToken

from server_clients.server import Server


class InteractiveOAuthConfig:
    """Configuration for InteractiveOAuthClient."""

    def __init__(
        self,
        server_url: Optional[str] = None,
        server_stack_name: Optional[str] = None,
        server_stack_url_output_key: str = "McpServerUrl",
        server_stack_region: str = "us-east-2",
        lookup_client_id_from_cloudformation: bool = True,
        auth_stack_name: str = "LambdaMcpServer-Auth",
        auth_stack_client_id_output_key: str = "InteractiveOAuthClientId",
        auth_stack_region: str = "us-east-2",
        **kwargs
    ):
        # Handle camelCase parameter names from JSON config
        self.server_url = kwargs.get('serverUrl', server_url)
        self.server_stack_name = kwargs.get('serverStackName', server_stack_name)
        self.server_stack_url_output_key = kwargs.get('serverStackUrlOutputKey', server_stack_url_output_key)
        self.server_stack_region = kwargs.get('serverStackRegion', server_stack_region)
        self.lookup_client_id_from_cloudformation = kwargs.get('lookupClientIdFromCloudformation', lookup_client_id_from_cloudformation)
        self.auth_stack_name = kwargs.get('authStackName', auth_stack_name)
        self.auth_stack_client_id_output_key = kwargs.get('authStackClientIdOutputKey', auth_stack_client_id_output_key)
        self.auth_stack_region = kwargs.get('authStackRegion', auth_stack_region)


class InMemoryTokenStorage(TokenStorage):
    """
    Simple in-memory token storage implementation.
    In production, you should persist tokens securely. However, for
    the demo chatbot, it's ok to ask the user to re-authenticate
    in the browser each time they run the demo.
    """

    def __init__(self):
        self._tokens: Optional[OAuthToken] = None
        self._client_info: Optional[OAuthClientInformationFull] = None

    async def get_tokens(self) -> Optional[OAuthToken]:
        return self._tokens

    async def set_tokens(self, tokens: OAuthToken) -> None:
        self._tokens = tokens

    async def get_client_info(self) -> Optional[OAuthClientInformationFull]:
        return self._client_info

    async def set_client_info(self, client_info: OAuthClientInformationFull) -> None:
        self._client_info = client_info


class CallbackHandler(BaseHTTPRequestHandler):
    """Simple HTTP handler to capture OAuth callback."""

    def __init__(self, request, client_address, server, callback_data):
        """Initialize with callback data storage."""
        self.callback_data = callback_data
        super().__init__(request, client_address, server)

    def do_GET(self):
        """Handle GET request from OAuth redirect."""
        parsed = urlparse(self.path)
        query_params = parse_qs(parsed.query)

        if "code" in query_params:
            self.callback_data["authorization_code"] = query_params["code"][0]
            self.callback_data["state"] = query_params.get("state", [None])[0]
            self.send_response(200)
            self.send_header("Content-type", "text/html")
            self.end_headers()
            self.wfile.write(
                b"""
            <html>
            <body>
                <h1>Authorization Successful!</h1>
                <p>You can close this window and return to the application.</p>
                <script>setTimeout(() => window.close(), 2000);</script>
            </body>
            </html>
            """
            )
        elif "error" in query_params:
            self.callback_data["error"] = query_params["error"][0]
            self.send_response(400)
            self.send_header("Content-type", "text/html")
            self.end_headers()
            error_msg = query_params["error"][0]
            self.wfile.write(
                f"""
            <html>
            <body>
                <h1>Authorization Failed</h1>
                <p>Error: {error_msg}</p>
                <p>You can close this window and return to the application.</p>
            </body>
            </html>
            """.encode()
            )
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        """Suppress default logging."""
        pass


class CallbackServer:
    """Simple server to handle OAuth callbacks."""

    def __init__(self, port=8090):
        self.port = port
        self.server = None
        self.thread = None
        self.callback_data = {"authorization_code": None, "state": None, "error": None}

    def _create_handler_with_data(self):
        """Create a handler class with access to callback data."""
        callback_data = self.callback_data

        class DataCallbackHandler(CallbackHandler):
            def __init__(self, request, client_address, server):
                super().__init__(request, client_address, server, callback_data)

        return DataCallbackHandler

    def start(self):
        """Start the callback server in a background thread."""
        handler_class = self._create_handler_with_data()
        self.server = HTTPServer(("localhost", self.port), handler_class)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        logging.debug(f"Started OAuth callback server on http://localhost:{self.port}")

    def stop(self):
        """Stop the callback server."""
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        if self.thread:
            self.thread.join(timeout=1)

    def wait_for_callback(self, timeout=300):
        """Wait for OAuth callback with timeout."""
        start_time = time.time()
        while time.time() - start_time < timeout:
            if self.callback_data["authorization_code"]:
                return self.callback_data["authorization_code"]
            elif self.callback_data["error"]:
                raise Exception(f"OAuth error: {self.callback_data['error']}")
            time.sleep(0.1)
        raise Exception("Timeout waiting for OAuth callback")

    def get_state(self):
        """Get the received state parameter."""
        return self.callback_data["state"]


class InteractiveOAuthClient(Server):
    """
    Manages MCP server connections and tool execution for streamable HTTP servers
    requiring interactive OAuth authentication.

    This client handles the complete OAuth flow including browser-based authorization.

    Since API Gateway creates a new, unique endpoint for each gateway, this
    client can lookup the gateway URL from a CloudFormation stack output instead of requiring
    the user to statically configure the server URL.

    The example OAuth-enabled MCP servers in this repo all require distributing an OAuth client ID
    to the clients, and do not support dynamic client registration. By default, this client will
    look up the client ID from a CloudFormation stack output to simplify configuration for the
    example chatbot.
    """

    def __init__(self, name: str, config: InteractiveOAuthConfig):
        # Convert config to dict for base class
        config_dict = {
            "server_url": config.server_url,
            "server_stack_name": config.server_stack_name,
            "server_stack_url_output_key": config.server_stack_url_output_key,
            "server_stack_region": config.server_stack_region,
            "lookup_client_id_from_cloudformation": config.lookup_client_id_from_cloudformation,
            "auth_stack_name": config.auth_stack_name,
            "auth_stack_client_id_output_key": config.auth_stack_client_id_output_key,
            "auth_stack_region": config.auth_stack_region,
        }
        super().__init__(name, config_dict)

        if not config.server_url and not config.server_stack_name:
            raise ValueError(
                "Either server_url must be provided or server_stack_name must be provided for CloudFormation lookup"
            )

        if config.server_url and config.server_stack_name:
            raise ValueError(
                "Only one of server_url or server_stack_name can be provided"
            )

        self.oauth_config = config
        self.callback_port = 8090
        self.callback_url = f"http://localhost:{self.callback_port}/callback"
        self._transport_context = None
        self._session_context = None
        self._streams = None

    async def initialize(self) -> None:
        """Initialize the server connection with OAuth authentication."""
        try:
            # Determine the server URL
            server_url = self.oauth_config.server_url
            if self.oauth_config.server_stack_name:
                logging.debug("Retrieving server URL from CloudFormation...")
                server_url = await self._get_server_url_from_cloudformation()
                # Update the config with the resolved URL
                self.config["server_url"] = server_url
                self.oauth_config.server_url = server_url

            if not server_url:
                raise ValueError(
                    "The server_url must be a valid string and cannot be undefined."
                )

            logging.debug(f"Connecting to OAuth-protected MCP server: {server_url}")

            # Create OAuth client metadata
            client_metadata_dict = {
                "client_name": f"MCP Client - {self.name}",
                "redirect_uris": [self.callback_url],
                "grant_types": ["authorization_code", "refresh_token"],
                "response_types": ["code"],
                "token_endpoint_auth_method": "none",  # No client secret for example servers
            }

            # Add client_id to metadata if available
            if self.oauth_config.lookup_client_id_from_cloudformation:
                logging.debug("Retrieving OAuth client ID from CloudFormation...")
                client_id = await self._get_client_id_from_cloudformation()
                if client_id:
                    client_metadata_dict["client_id"] = client_id

            # Create callback server
            callback_server = CallbackServer(port=self.callback_port)
            callback_server.start()

            async def callback_handler() -> tuple[str, Optional[str]]:
                """Wait for OAuth callback and return auth code and state."""
                logging.debug("Waiting for authorization callback...")
                try:
                    auth_code = callback_server.wait_for_callback(timeout=300)
                    return auth_code, callback_server.get_state()
                finally:
                    callback_server.stop()

            async def redirect_handler(authorization_url: str) -> None:
                """Handle OAuth redirect by opening browser."""
                logging.debug(f"OAuth redirect handler called - opening browser")
                self._open_browser(authorization_url)

            # Create OAuth authentication handler
            oauth_auth = OAuthClientProvider(
                server_url=server_url,
                client_metadata=OAuthClientMetadata.model_validate(
                    client_metadata_dict
                ),
                storage=InMemoryTokenStorage(),
                redirect_handler=redirect_handler,
                callback_handler=callback_handler,
            )

            logging.debug("Creating transport with OAuth provider...")
            self._transport_context = streamablehttp_client(
                url=server_url,
                auth=oauth_auth,
                timeout=timedelta(seconds=60),
            )

            # Enter the transport context
            self._streams = await self._transport_context.__aenter__()
            read_stream, write_stream, get_session_id = self._streams

            logging.debug("Creating MCP session...")
            self._session_context = ClientSession(read_stream, write_stream)
            self.session = await self._session_context.__aenter__()

            logging.debug("Initializing MCP session...")
            await self.session.initialize()
            logging.debug("MCP session initialized successfully")

        except Exception as error:
            logging.error(f"Error initializing OAuth server {self.name}: {error}")
            raise error

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit with proper cleanup."""
        try:
            if self._session_context:
                await self._session_context.__aexit__(exc_type, exc_val, exc_tb)
                self._session_context = None
                self.session = None

            if self._transport_context:
                await self._transport_context.__aexit__(exc_type, exc_val, exc_tb)
                self._transport_context = None
                self._streams = None
        except Exception as e:
            logging.error(f"Error during cleanup: {e}")

        # Call parent cleanup
        await super().__aexit__(exc_type, exc_val, exc_tb)

    async def _get_client_id_from_cloudformation(self) -> str:
        """Retrieve the OAuth client ID from CloudFormation stack outputs."""
        try:
            logging.debug(
                f"Retrieving client ID from CloudFormation stack: {self.oauth_config.auth_stack_name}"
            )

            # Create CloudFormation client
            session = boto3.Session()
            cf_client = session.client(
                "cloudformation", region_name=self.oauth_config.auth_stack_region
            )

            response = cf_client.describe_stacks(
                StackName=self.oauth_config.auth_stack_name
            )

            if not response.get("Stacks"):
                raise ValueError(
                    f"CloudFormation stack '{self.oauth_config.auth_stack_name}' not found"
                )

            stack = response["Stacks"][0]
            if not stack.get("Outputs"):
                raise ValueError(
                    f"No outputs found in CloudFormation stack '{self.oauth_config.auth_stack_name}'"
                )

            client_id_output = next(
                (
                    output
                    for output in stack["Outputs"]
                    if output["OutputKey"]
                    == self.oauth_config.auth_stack_client_id_output_key
                ),
                None,
            )

            if not client_id_output or not client_id_output.get("OutputValue"):
                raise ValueError(
                    f"Client ID output not found in CloudFormation stack. Output key: {self.oauth_config.auth_stack_client_id_output_key}"
                )

            client_id = client_id_output["OutputValue"]
            logging.debug(f"Retrieved client ID: {client_id}")
            return client_id

        except ClientError as error:
            error_code = error.response["Error"]["Code"]
            if error_code == "ValidationException":
                raise ValueError(
                    f"CloudFormation stack '{self.oauth_config.auth_stack_name}' does not exist or is not accessible"
                )
            elif error_code in ["AccessDenied", "UnauthorizedOperation"]:
                raise ValueError(
                    f"Insufficient permissions to access CloudFormation stack '{self.oauth_config.auth_stack_name}'. "
                    "Ensure your AWS credentials have cloudformation:DescribeStacks permission."
                )
            else:
                raise ValueError(
                    f"Could not retrieve OAuth client ID from CloudFormation stack {self.oauth_config.auth_stack_name}: {error}"
                )

        except Exception as error:
            logging.error(f"Failed to retrieve client ID from CloudFormation:", error)
            raise ValueError(
                f"Could not retrieve OAuth client ID from CloudFormation stack {self.oauth_config.auth_stack_name}: {error}"
            )

    async def _get_server_url_from_cloudformation(self) -> str:
        """Retrieve the server URL from CloudFormation stack outputs."""
        try:
            logging.debug(
                f"Retrieving server URL from CloudFormation stack: {self.oauth_config.server_stack_name}"
            )

            # Create CloudFormation client
            session = boto3.Session()
            cf_client = session.client(
                "cloudformation", region_name=self.oauth_config.server_stack_region
            )

            response = cf_client.describe_stacks(
                StackName=self.oauth_config.server_stack_name
            )

            if not response.get("Stacks"):
                raise ValueError(
                    f"CloudFormation stack '{self.oauth_config.server_stack_name}' not found"
                )

            stack = response["Stacks"][0]
            if not stack.get("Outputs"):
                raise ValueError(
                    f"No outputs found in CloudFormation stack '{self.oauth_config.server_stack_name}'"
                )

            server_url_output = next(
                (
                    output
                    for output in stack["Outputs"]
                    if output["OutputKey"]
                    == self.oauth_config.server_stack_url_output_key
                ),
                None,
            )

            if not server_url_output or not server_url_output.get("OutputValue"):
                raise ValueError(
                    f"Server URL output not found in CloudFormation stack. Output key: {self.oauth_config.server_stack_url_output_key}"
                )

            server_url = server_url_output["OutputValue"]
            logging.debug(f"Retrieved server URL: {server_url}")
            return server_url

        except ClientError as error:
            error_code = error.response["Error"]["Code"]
            if error_code == "ValidationException":
                raise ValueError(
                    f"CloudFormation stack '{self.oauth_config.server_stack_name}' does not exist or is not accessible"
                )
            elif error_code in ["AccessDenied", "UnauthorizedOperation"]:
                raise ValueError(
                    f"Insufficient permissions to access CloudFormation stack '{self.oauth_config.server_stack_name}'. "
                    "Ensure your AWS credentials have cloudformation:DescribeStacks permission."
                )
            else:
                raise ValueError(
                    f"Could not retrieve server URL from CloudFormation stack {self.oauth_config.server_stack_name}: {error}"
                )

        except Exception as error:
            logging.error(f"Failed to retrieve server URL from CloudFormation:", error)
            raise ValueError(
                f"Could not retrieve server URL from CloudFormation stack {self.oauth_config.server_stack_name}: {error}"
            )

    def _open_browser(self, url: str) -> None:
        """Open the authorization URL in the user's default browser."""
        logging.debug(f"Opening browser for authorization: {url}")
        try:
            webbrowser.open(url)
        except Exception as error:
            logging.error(f"Failed to open browser: {error}")
            logging.info(f"Please manually open: {url}")
