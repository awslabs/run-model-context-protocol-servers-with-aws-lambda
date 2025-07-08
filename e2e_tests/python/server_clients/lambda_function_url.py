"""
Lambda Function URL client for MCP servers running behind Lambda function URLs.

This client uses AWS SigV4 authentication to communicate with MCP servers
deployed as Lambda functions with function URLs enabled.
"""

import logging
from datetime import timedelta
from typing import Optional

import boto3
from botocore.exceptions import ClientError

from mcp.client.session import ClientSession
from mcp_lambda.client.streamable_http_sigv4 import streamablehttp_client_with_sigv4

from server_clients.server import Server


class LambdaFunctionUrlConfig:
    """Configuration for LambdaFunctionUrlClient."""

    def __init__(
        self,
        function_url: Optional[str] = None,
        stack_name: Optional[str] = None,
        stack_url_output_key: str = "FunctionUrl",
        region: str = "us-east-2",
        **kwargs,
    ):
        # Handle camelCase parameter names from JSON config
        self.function_url = kwargs.get("functionUrl", function_url)
        self.stack_name = kwargs.get("stackName", stack_name)
        self.stack_url_output_key = kwargs.get(
            "stackUrlOutputKey", stack_url_output_key
        )
        self.region = kwargs.get("region", region)


class LambdaFunctionUrlClient(Server):
    """
    Manages MCP server connections and tool execution for servers running behind
    Lambda function URLs with AWS SigV4 authentication.

    This client can lookup the function URL from a CloudFormation stack output
    instead of requiring the user to statically configure the URL.
    """

    def __init__(self, name: str, config: LambdaFunctionUrlConfig):
        # Convert config to dict for base class
        config_dict = {
            "function_url": config.function_url,
            "stack_name": config.stack_name,
            "stack_url_output_key": config.stack_url_output_key,
            "region": config.region,
        }
        super().__init__(name, config_dict)

        if not config.function_url and not config.stack_name:
            raise ValueError(
                "Either function_url must be provided or stack_name must be provided for CloudFormation lookup"
            )

        if config.function_url and config.stack_name:
            raise ValueError("Only one of function_url or stack_name can be provided")

        self.lambda_config = config
        self._transport_context = None
        self._session_context = None
        self._streams = None

    async def initialize(self) -> None:
        """Initialize the server connection with AWS SigV4 authentication."""
        try:
            # Determine the function URL
            function_url = self.lambda_config.function_url
            if self.lambda_config.stack_name:
                logging.debug("Retrieving function URL from CloudFormation...")
                function_url = await self._get_function_url_from_cloudformation()
                # Update the config with the resolved URL
                self.config["function_url"] = function_url
                self.lambda_config.function_url = function_url

            if not function_url:
                raise ValueError(
                    "The function_url must be a valid string and cannot be undefined."
                )

            logging.debug(f"Connecting to Lambda function URL: {function_url}")

            session = boto3.Session()
            credentials = session.get_credentials()
            if not credentials:
                raise ValueError(
                    "AWS credentials not found. Please configure your AWS credentials."
                )

            logging.debug("Creating transport with SigV4 authentication...")
            self._transport_context = streamablehttp_client_with_sigv4(
                url=function_url,
                credentials=credentials,
                service="lambda",
                region=self.lambda_config.region,
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
            logging.error(
                f"Error initializing Lambda function URL client {self.name}: {error}"
            )
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

    async def _get_function_url_from_cloudformation(self) -> str:
        """Retrieve the Lambda function URL from CloudFormation stack outputs."""
        try:
            logging.debug(
                f"Retrieving function URL from CloudFormation stack: {self.lambda_config.stack_name}"
            )

            # Create CloudFormation client
            session = boto3.Session()
            cf_client = session.client(
                "cloudformation", region_name=self.lambda_config.region
            )

            response = cf_client.describe_stacks(
                StackName=self.lambda_config.stack_name
            )

            if not response.get("Stacks"):
                raise ValueError(
                    f"CloudFormation stack '{self.lambda_config.stack_name}' not found"
                )

            stack = response["Stacks"][0]
            if not stack.get("Outputs"):
                raise ValueError(
                    f"No outputs found in CloudFormation stack '{self.lambda_config.stack_name}'"
                )

            function_url_output = next(
                (
                    output
                    for output in stack["Outputs"]
                    if output["OutputKey"] == self.lambda_config.stack_url_output_key
                ),
                None,
            )

            if not function_url_output or not function_url_output.get("OutputValue"):
                raise ValueError(
                    f"Function URL output not found in CloudFormation stack. Output key: {self.lambda_config.stack_url_output_key}"
                )

            function_url = function_url_output["OutputValue"]
            logging.debug(f"Retrieved function URL: {function_url}")
            return function_url

        except ClientError as error:
            error_code = error.response["Error"]["Code"]
            if error_code == "ValidationException":
                raise ValueError(
                    f"CloudFormation stack '{self.lambda_config.stack_name}' does not exist or is not accessible"
                )
            elif error_code in ["AccessDenied", "UnauthorizedOperation"]:
                raise ValueError(
                    f"Insufficient permissions to access CloudFormation stack '{self.lambda_config.stack_name}'. "
                    "Ensure your AWS credentials have cloudformation:DescribeStacks permission."
                )
            else:
                raise ValueError(
                    f"Could not retrieve function URL from CloudFormation stack {self.lambda_config.stack_name}: {error}"
                )

        except Exception as error:
            logging.error(
                f"Failed to retrieve function URL from CloudFormation:", error
            )
            raise ValueError(
                f"Could not retrieve function URL from CloudFormation stack {self.lambda_config.stack_name}: {error}"
            )
