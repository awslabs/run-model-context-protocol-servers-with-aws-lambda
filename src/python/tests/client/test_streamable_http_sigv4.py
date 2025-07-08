"""
Tests for StreamableHTTP Client Transport with AWS SigV4 Signing.
"""

from datetime import timedelta
from unittest import mock
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials

from mcp_lambda.client.streamable_http_sigv4 import (
    SigV4HTTPXAuth,
    StreamableHTTPTransportWithSigV4,
    streamablehttp_client_with_sigv4,
)


class TestSigV4HTTPXAuth:
    """Test cases for SigV4HTTPXAuth class."""

    def setup_method(self):
        """Set up test fixtures."""
        self.credentials = Credentials(
            access_key="AKIAIOSFODNN7EXAMPLE",
            secret_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            token="test-token",
        )
        self.service = "lambda"
        self.region = "us-east-1"
        self.auth = SigV4HTTPXAuth(self.credentials, self.service, self.region)

    def test_init(self):
        """Test SigV4HTTPXAuth initialization."""
        assert self.auth.credentials == self.credentials
        assert self.auth.service == self.service
        assert self.auth.region == self.region
        assert self.auth.signer is not None

    @mock.patch("mcp_lambda.client.streamable_http_sigv4.SigV4Auth")
    def test_auth_flow_signs_request(self, mock_sigv4_auth):
        """Test that auth_flow properly signs requests."""
        # Setup mock signer
        mock_signer = Mock()
        mock_sigv4_auth.return_value = mock_signer

        # Create auth instance
        auth = SigV4HTTPXAuth(self.credentials, self.service, self.region)

        # Create test request
        request = httpx.Request(
            method="POST",
            url="https://example.com/test",
            headers={"content-type": "application/json", "connection": "keep-alive"},
            content=b'{"test": "data"}',
        )

        # Mock the signer to add authorization header
        def mock_add_auth(aws_request):
            aws_request.headers["Authorization"] = "AWS4-HMAC-SHA256 test-signature"

        mock_signer.add_auth.side_effect = mock_add_auth

        # Execute auth flow
        auth_generator = auth.auth_flow(request)
        signed_request = next(auth_generator)

        # Verify signer was called with correct AWS request
        mock_signer.add_auth.assert_called_once()
        aws_request_arg = mock_signer.add_auth.call_args[0][0]
        assert isinstance(aws_request_arg, AWSRequest)
        assert aws_request_arg.method == "POST"
        assert aws_request_arg.url == "https://example.com/test"
        assert aws_request_arg.data == b'{"test": "data"}'

        # Verify connection header was removed, but other headers remain
        assert "connection" not in aws_request_arg.headers
        assert "content-type" in aws_request_arg.headers

        # Verify authorization header was added to original request, and none were removed
        assert "Authorization" in signed_request.headers
        assert (
            signed_request.headers["Authorization"] == "AWS4-HMAC-SHA256 test-signature"
        )
        assert "connection" in signed_request.headers
        assert "content-type" in signed_request.headers

    def test_auth_flow_handles_missing_connection_header(self):
        """Test that auth flow works when connection header is not present."""
        # Create test request without connection header
        request = httpx.Request(
            method="GET",
            url="https://example.com/test",
            headers={"user-agent": "test-agent"},
        )

        # Mock the signer
        with mock.patch.object(self.auth.signer, "add_auth") as mock_add_auth:
            # Execute auth flow - should not raise an error
            auth_generator = self.auth.auth_flow(request)
            next(auth_generator)

            # Verify signer was called and no connection header was passed
            aws_request_arg = mock_add_auth.call_args[0][0]
            assert "connection" not in aws_request_arg.headers
            assert "user-agent" in aws_request_arg.headers


class TestStreamableHTTPTransportWithSigV4:
    """Test cases for StreamableHTTPTransportWithSigV4 class."""

    def setup_method(self):
        """Set up test fixtures."""
        self.credentials = Credentials(
            access_key="AKIAIOSFODNN7EXAMPLE",
            secret_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        )
        self.service = "lambda"
        self.region = "us-east-1"
        self.url = "https://example.com/mcp"

    @mock.patch(
        "mcp_lambda.client.streamable_http_sigv4.StreamableHTTPTransport.__init__"
    )
    def test_init_with_defaults(self, mock_parent_init):
        """Test initialization with default parameters."""
        mock_parent_init.return_value = None

        transport = StreamableHTTPTransportWithSigV4(
            url=self.url,
            credentials=self.credentials,
            service=self.service,
            region=self.region,
        )

        # Verify parent was initialized with correct parameters
        mock_parent_init.assert_called_once()
        call_args = mock_parent_init.call_args
        assert call_args[1]["url"] == self.url
        assert call_args[1]["headers"] is None
        assert call_args[1]["timeout"] == 30
        assert call_args[1]["sse_read_timeout"] == 60 * 5
        assert isinstance(call_args[1]["auth"], SigV4HTTPXAuth)

        # Verify instance attributes
        assert transport.credentials == self.credentials
        assert transport.service == self.service
        assert transport.region == self.region

    @mock.patch(
        "mcp_lambda.client.streamable_http_sigv4.StreamableHTTPTransport.__init__"
    )
    def test_init_with_custom_parameters(self, mock_parent_init):
        """Test initialization with custom parameters."""
        mock_parent_init.return_value = None

        custom_headers = {"X-Custom": "value"}
        custom_timeout = 60
        custom_sse_timeout = timedelta(minutes=10)

        StreamableHTTPTransportWithSigV4(
            url=self.url,
            credentials=self.credentials,
            service=self.service,
            region=self.region,
            headers=custom_headers,
            timeout=custom_timeout,
            sse_read_timeout=custom_sse_timeout,
        )

        # Verify parent was initialized with custom parameters
        mock_parent_init.assert_called_once()
        call_args = mock_parent_init.call_args
        assert call_args[1]["url"] == self.url
        assert call_args[1]["headers"] == custom_headers
        assert call_args[1]["timeout"] == custom_timeout
        assert call_args[1]["sse_read_timeout"] == custom_sse_timeout
        assert isinstance(call_args[1]["auth"], SigV4HTTPXAuth)

    @mock.patch(
        "mcp_lambda.client.streamable_http_sigv4.StreamableHTTPTransport.__init__"
    )
    def test_sigv4_auth_configuration(self, mock_parent_init):
        """Test that SigV4 auth is configured correctly."""
        mock_parent_init.return_value = None

        StreamableHTTPTransportWithSigV4(
            url=self.url,
            credentials=self.credentials,
            service=self.service,
            region=self.region,
        )

        # Get the auth object passed to parent
        call_args = mock_parent_init.call_args
        auth = call_args[1]["auth"]

        assert isinstance(auth, SigV4HTTPXAuth)
        assert auth.credentials == self.credentials
        assert auth.service == self.service
        assert auth.region == self.region


class TestStreamableHttpClientWithSigV4:
    """Test cases for streamablehttp_client_with_sigv4 function."""

    def setup_method(self):
        """Set up test fixtures."""
        self.credentials = Credentials(
            access_key="AKIAIOSFODNN7EXAMPLE",
            secret_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        )
        self.service = "lambda"
        self.region = "us-east-1"
        self.url = "https://example.com/mcp"

    @pytest.mark.anyio
    @mock.patch("mcp_lambda.client.streamable_http_sigv4.streamablehttp_client")
    async def test_client_with_defaults(self, mock_streamablehttp_client):
        """Test client creation with default parameters."""
        # Mock the streamablehttp_client context manager
        mock_result = (Mock(), Mock(), Mock())
        mock_context = AsyncMock()
        mock_context.__aenter__.return_value = mock_result
        mock_streamablehttp_client.return_value = mock_context

        async with streamablehttp_client_with_sigv4(
            url=self.url,
            credentials=self.credentials,
            service=self.service,
            region=self.region,
        ) as result:
            assert result == mock_result

        # Verify streamablehttp_client was called with correct parameters
        mock_streamablehttp_client.assert_called_once()
        call_args = mock_streamablehttp_client.call_args
        assert call_args[1]["url"] == self.url
        assert call_args[1]["headers"] is None
        assert call_args[1]["timeout"] == 30
        assert call_args[1]["sse_read_timeout"] == 60 * 5
        assert call_args[1]["terminate_on_close"] is True
        assert isinstance(call_args[1]["auth"], SigV4HTTPXAuth)

    @pytest.mark.anyio
    @mock.patch("mcp_lambda.client.streamable_http_sigv4.streamablehttp_client")
    async def test_client_with_custom_parameters(self, mock_streamablehttp_client):
        """Test client creation with custom parameters."""
        # Mock the streamablehttp_client context manager
        mock_result = (Mock(), Mock(), Mock())
        mock_context = AsyncMock()
        mock_context.__aenter__.return_value = mock_result
        mock_streamablehttp_client.return_value = mock_context

        custom_headers = {"X-Custom": "value"}
        custom_timeout = 60
        custom_sse_timeout = timedelta(minutes=10)
        custom_httpx_factory = Mock()

        async with streamablehttp_client_with_sigv4(
            url=self.url,
            credentials=self.credentials,
            service=self.service,
            region=self.region,
            headers=custom_headers,
            timeout=custom_timeout,
            sse_read_timeout=custom_sse_timeout,
            terminate_on_close=False,
            httpx_client_factory=custom_httpx_factory,
        ) as result:
            assert result == mock_result

        # Verify streamablehttp_client was called with custom parameters
        mock_streamablehttp_client.assert_called_once()
        call_args = mock_streamablehttp_client.call_args
        assert call_args[1]["url"] == self.url
        assert call_args[1]["headers"] == custom_headers
        assert call_args[1]["timeout"] == custom_timeout
        assert call_args[1]["sse_read_timeout"] == custom_sse_timeout
        assert call_args[1]["terminate_on_close"] is False
        assert call_args[1]["httpx_client_factory"] == custom_httpx_factory
        assert isinstance(call_args[1]["auth"], SigV4HTTPXAuth)

    @pytest.mark.anyio
    @mock.patch("mcp_lambda.client.streamable_http_sigv4.streamablehttp_client")
    async def test_sigv4_auth_configuration(self, mock_streamablehttp_client):
        """Test that SigV4 auth is configured correctly in client."""
        # Mock the streamablehttp_client context manager
        mock_result = (Mock(), Mock(), Mock())
        mock_context = AsyncMock()
        mock_context.__aenter__.return_value = mock_result
        mock_streamablehttp_client.return_value = mock_context

        async with streamablehttp_client_with_sigv4(
            url=self.url,
            credentials=self.credentials,
            service=self.service,
            region=self.region,
        ):
            pass

        # Get the auth object passed to streamablehttp_client
        call_args = mock_streamablehttp_client.call_args
        auth = call_args[1]["auth"]

        assert isinstance(auth, SigV4HTTPXAuth)
        assert auth.credentials == self.credentials
        assert auth.service == self.service
        assert auth.region == self.region

    @pytest.mark.anyio
    @mock.patch("mcp_lambda.client.streamable_http_sigv4.streamablehttp_client")
    async def test_client_exception_handling(self, mock_streamablehttp_client):
        """Test that exceptions from underlying client are propagated."""
        # Make streamablehttp_client raise an exception
        mock_streamablehttp_client.side_effect = Exception("Connection failed")

        with pytest.raises(Exception, match="Connection failed"):
            async with streamablehttp_client_with_sigv4(
                url=self.url,
                credentials=self.credentials,
                service=self.service,
                region=self.region,
            ):
                pass
