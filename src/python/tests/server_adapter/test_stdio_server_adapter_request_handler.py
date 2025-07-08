"""
Tests for StdioServerAdapterRequestHandler.
"""

from unittest.mock import Mock, patch

import pytest
from aws_lambda_typing.context import Context as LambdaContext
from mcp.client.stdio import StdioServerParameters
from mcp.types import INTERNAL_ERROR, JSONRPCError, JSONRPCRequest, JSONRPCResponse

from mcp_lambda.server_adapter import StdioServerAdapterRequestHandler, stdio_server_adapter


@pytest.fixture
def mock_context():
    """Create a mock Lambda context."""
    context = Mock(spec=LambdaContext)
    context.function_name = "test-function"
    context.function_version = "1"
    context.invoked_function_arn = "arn:aws:lambda:us-east-1:123456789012:function:test-function"
    context.memory_limit_in_mb = 128
    context.remaining_time_in_millis = lambda: 30000
    context.request_id = "test-request-id"
    context.log_group_name = "/aws/lambda/test-function"
    context.log_stream_name = "2023/01/01/[$LATEST]test-stream"
    return context


@pytest.fixture
def server_params():
    """Create test server parameters using the real echo server."""
    return StdioServerParameters(
        command="python",
        args=["tests/minimal_mcp_server/echo_server.py"]
    )


@pytest.fixture
def invalid_server_params():
    """Create invalid server parameters for error testing."""
    return StdioServerParameters(
        command="does_not_exist",
    )


@pytest.fixture
def handler(server_params):
    """Create handler instance."""
    return StdioServerAdapterRequestHandler(server_params)


@pytest.fixture
def invalid_handler(invalid_server_params):
    """Create handler instance with invalid server params."""
    return StdioServerAdapterRequestHandler(invalid_server_params)


class TestStdioServerAdapterRequestHandler:
    """Tests for StdioServerAdapterRequestHandler."""

    def test_init(self, server_params):
        """Test handler initialization."""
        handler = StdioServerAdapterRequestHandler(server_params)
        assert handler.server_params == server_params

    def test_successful_ping_request(self, handler, mock_context):
        """Test successful ping request handling with real server."""
        request = JSONRPCRequest(
            jsonrpc="2.0",
            method="ping",
            id=1
        )

        # Mock the stdio_server_adapter to use the real implementation
        request_dict = request.model_dump(by_alias=True, exclude_none=True)
        expected_response = stdio_server_adapter(handler.server_params, request_dict, mock_context)
        
        with patch(
            'mcp_lambda.server_adapter.stdio_server_adapter_request_handler.stdio_server_adapter'
        ) as mock_adapter:
            mock_adapter.return_value = expected_response
            
            # Call the synchronous handler
            result = handler.handle_request(request, mock_context)

            # Verify the result is a JSONRPCResponse
            assert isinstance(result, JSONRPCResponse)
            assert result.jsonrpc == "2.0"
            assert result.result == {}
            assert result.id == 1

    def test_successful_initialize_request(self, handler, mock_context):
        """Test successful initialize request handling with real server."""
        request = JSONRPCRequest(
            jsonrpc="2.0",
            method="initialize",
            params={
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "mcp", "version": "0.1.0"},
            },
            id=2
        )

        # Mock the stdio_server_adapter to use the real implementation
        request_dict = request.model_dump(by_alias=True, exclude_none=True)
        expected_response = stdio_server_adapter(handler.server_params, request_dict, mock_context)
        
        with patch(
            'mcp_lambda.server_adapter.stdio_server_adapter_request_handler.stdio_server_adapter'
        ) as mock_adapter:
            mock_adapter.return_value = expected_response
            
            # Call the synchronous handler
            result = handler.handle_request(request, mock_context)

            # Verify the result is a JSONRPCResponse
            assert isinstance(result, JSONRPCResponse)
            assert result.jsonrpc == "2.0"
            assert result.result is not None
            assert result.id == 2

    def test_successful_list_tools_request(self, handler, mock_context):
        """Test successful tools/list request handling with real server."""
        request = JSONRPCRequest(
            jsonrpc="2.0",
            method="tools/list",
            id=3
        )

        # Mock the stdio_server_adapter to use the real implementation
        request_dict = request.model_dump(by_alias=True, exclude_none=True)
        expected_response = stdio_server_adapter(handler.server_params, request_dict, mock_context)
        
        with patch(
            'mcp_lambda.server_adapter.stdio_server_adapter_request_handler.stdio_server_adapter'
        ) as mock_adapter:
            mock_adapter.return_value = expected_response
            
            # Call the synchronous handler
            result = handler.handle_request(request, mock_context)

            # Verify the result is a JSONRPCResponse
            assert isinstance(result, JSONRPCResponse)
            assert result.jsonrpc == "2.0"
            assert result.result == {
                "tools": [
                    {
                        "name": "echo",
                        "description": "Echo back the provided message",
                        "inputSchema": {
                            "properties": {
                                "message": {"title": "Message", "type": "string"}
                            },
                            "required": ["message"],
                            "title": "echoArguments",
                            "type": "object",
                        },
                        "outputSchema": {
                            "properties": {
                                "result": {"title": "Result", "type": "string"}
                            },
                            "required": ["result"],
                            "title": "echoOutput",
                            "type": "object",
                        },
                    }
                ]
            }
            assert result.id == 3

    def test_successful_tool_call_request(self, handler, mock_context):
        """Test successful tools/call request handling with real server."""
        request = JSONRPCRequest(
            jsonrpc="2.0",
            method="tools/call",
            params={
                "name": "echo",
                "arguments": {
                    "message": "Hello world",
                },
            },
            id=4
        )

        # Mock the stdio_server_adapter to use the real implementation
        request_dict = request.model_dump(by_alias=True, exclude_none=True)
        expected_response = stdio_server_adapter(handler.server_params, request_dict, mock_context)
        
        with patch(
            'mcp_lambda.server_adapter.stdio_server_adapter_request_handler.stdio_server_adapter'
        ) as mock_adapter:
            mock_adapter.return_value = expected_response
            
            # Call the synchronous handler
            result = handler.handle_request(request, mock_context)

            # Verify the result is a JSONRPCResponse
            assert isinstance(result, JSONRPCResponse)
            assert result.jsonrpc == "2.0"
            assert result.result == {
                "content": [{"type": "text", "text": "Echo: Hello world"}],
                "structuredContent": {"result": "Echo: Hello world"},
                "isError": False,
            }
            assert result.id == 4

    def test_unknown_tool_call_request(self, handler, mock_context):
        """Test unknown tool call request handling with real server."""
        request = JSONRPCRequest(
            jsonrpc="2.0",
            method="tools/call",
            params={
                "name": "does_not_exist",
                "arguments": {
                    "message": "Hello world",
                },
            },
            id=5
        )

        # Mock the stdio_server_adapter to use the real implementation
        request_dict = request.model_dump(by_alias=True, exclude_none=True)
        expected_response = stdio_server_adapter(handler.server_params, request_dict, mock_context)
        
        with patch(
            'mcp_lambda.server_adapter.stdio_server_adapter_request_handler.stdio_server_adapter'
        ) as mock_adapter:
            mock_adapter.return_value = expected_response
            
            # Call the synchronous handler
            result = handler.handle_request(request, mock_context)

            # Verify the result is a JSONRPCResponse with error content
            assert isinstance(result, JSONRPCResponse)
            assert result.jsonrpc == "2.0"
            assert result.result == {
                "content": [{"type": "text", "text": "Unknown tool: does_not_exist"}],
                "isError": True,
            }
            assert result.id == 5

    def test_invalid_server_params(self, invalid_handler, mock_context):
        """Test handling of invalid server parameters."""
        request = JSONRPCRequest(
            jsonrpc="2.0",
            method="ping",
            id=6
        )

        # Mock the stdio_server_adapter to use the real implementation
        request_dict = request.model_dump(by_alias=True, exclude_none=True)
        expected_response = stdio_server_adapter(invalid_handler.server_params, request_dict, mock_context)
        
        with patch(
            'mcp_lambda.server_adapter.stdio_server_adapter_request_handler.stdio_server_adapter'
        ) as mock_adapter:
            mock_adapter.return_value = expected_response
            
            # Call the synchronous handler
            result = invalid_handler.handle_request(request, mock_context)

            # Verify the result is a JSONRPCError
            assert isinstance(result, JSONRPCError)
            assert result.jsonrpc == "2.0"
            assert result.error.code == 500
            assert result.error.message == "Internal failure, please check Lambda function logs"
            assert result.id == 6

    def test_server_misbehavior(self, mock_context):
        """Test handling of server misbehavior using tee command."""
        # This 'server' responds back to the request with a copy of the request.
        # It is not valid behavior for the server.
        server_params = StdioServerParameters(command="tee")
        handler = StdioServerAdapterRequestHandler(server_params)
        
        request = JSONRPCRequest(
            jsonrpc="2.0",
            method="ping",
            id=7
        )

        # Mock the stdio_server_adapter to use the real implementation
        request_dict = request.model_dump(by_alias=True, exclude_none=True)
        expected_response = stdio_server_adapter(server_params, request_dict, mock_context)
        
        with patch(
            'mcp_lambda.server_adapter.stdio_server_adapter_request_handler.stdio_server_adapter'
        ) as mock_adapter:
            mock_adapter.return_value = expected_response
            
            # Call the synchronous handler
            result = handler.handle_request(request, mock_context)

            # Verify the result is a JSONRPCError
            assert isinstance(result, JSONRPCError)
            assert result.jsonrpc == "2.0"
            assert result.error.code == 500
            assert result.error.message == "Internal failure, please check Lambda function logs"
            assert result.id == 7

    def test_request_serialization(self, handler, mock_context):
        """Test that complex request parameters are properly handled."""
        request = JSONRPCRequest(
            jsonrpc="2.0",
            method="tools/call",
            params={
                "name": "echo",
                "arguments": {
                    "message": "Complex message with special chars: àáâãäå",
                },
            },
            id=8
        )

        # Mock the stdio_server_adapter to use the real implementation
        request_dict = request.model_dump(by_alias=True, exclude_none=True)
        expected_response = stdio_server_adapter(handler.server_params, request_dict, mock_context)
        
        with patch(
            'mcp_lambda.server_adapter.stdio_server_adapter_request_handler.stdio_server_adapter'
        ) as mock_adapter:
            mock_adapter.return_value = expected_response
            
            # Call the synchronous handler
            result = handler.handle_request(request, mock_context)

            # Verify the result is a JSONRPCResponse with the complex message echoed back
            assert isinstance(result, JSONRPCResponse)
            assert result.jsonrpc == "2.0"
            assert result.result == {
                "content": [{"type": "text", "text": "Echo: Complex message with special chars: àáâãäå"}],
                "structuredContent": {"result": "Echo: Complex message with special chars: àáâãäå"},
                "isError": False,
            }
            assert result.id == 8

    # Tests that require mocking for specific error scenarios
    def test_adapter_exception(self, handler, mock_context):
        """Test handling of exceptions from the stdio adapter."""
        request = JSONRPCRequest(
            jsonrpc="2.0",
            method="test",
            id=9
        )

        # Mock the stdio_server_adapter to raise an exception
        with patch(
            'mcp_lambda.server_adapter.stdio_server_adapter_request_handler.stdio_server_adapter'
        ) as mock_adapter:
            mock_adapter.side_effect = Exception("Server failed to start")

            result = handler.handle_request(request, mock_context)

            # Verify the result is a JSONRPCError
            assert isinstance(result, JSONRPCError)
            assert result.jsonrpc == "2.0"
            assert result.error.code == INTERNAL_ERROR
            assert result.error.message == "Internal error"
            assert result.error.data is not None and "Server failed to start" in result.error.data
            assert result.id == 9

    def test_invalid_response_format(self, handler, mock_context):
        """Test handling of invalid response format from adapter."""
        request = JSONRPCRequest(
            jsonrpc="2.0",
            method="test",
            id=10
        )

        # Mock the stdio_server_adapter to return an invalid response
        mock_response = {
            "jsonrpc": "2.0",
            "invalid_field": "should not be here",
            "id": 10
        }

        with patch(
            'mcp_lambda.server_adapter.stdio_server_adapter_request_handler.stdio_server_adapter'
        ) as mock_adapter:
            mock_adapter.return_value = mock_response

            result = handler.handle_request(request, mock_context)

            # Verify the result is a JSONRPCError
            assert isinstance(result, JSONRPCError)
            assert result.jsonrpc == "2.0"
            assert result.error.code == INTERNAL_ERROR
            assert "Unexpected response format" in result.error.message
            assert result.id == 10

    def test_non_dict_response(self, handler, mock_context):
        """Test handling of non-dictionary response from adapter."""
        request = JSONRPCRequest(
            jsonrpc="2.0",
            method="test",
            id=11
        )

        # Mock the stdio_server_adapter to return a non-dictionary
        with patch(
            'mcp_lambda.server_adapter.stdio_server_adapter_request_handler.stdio_server_adapter'
        ) as mock_adapter:
            mock_adapter.return_value = "invalid response"

            result = handler.handle_request(request, mock_context)

            # Verify the result is a JSONRPCError
            assert isinstance(result, JSONRPCError)
            assert result.jsonrpc == "2.0"
            assert result.error.code == INTERNAL_ERROR
            assert "Invalid response type" in result.error.message
            assert result.error.data is not None and "Expected dictionary, got <class 'str'>" in result.error.data
            assert result.id == 11

    def test_malformed_success_response(self, handler, mock_context):
        """Test handling of malformed success response from adapter."""
        request = JSONRPCRequest(
            jsonrpc="2.0",
            method="test",
            id=12
        )

        # Mock the stdio_server_adapter to return a malformed success response
        mock_response = {
            "jsonrpc": "2.0",
            "result": "valid result",
            "id": "invalid_id_type"  # Should be int, not string
        }

        with patch(
            'mcp_lambda.server_adapter.stdio_server_adapter_request_handler.stdio_server_adapter'
        ) as mock_adapter:
            mock_adapter.return_value = mock_response

            result = handler.handle_request(request, mock_context)

            # The handler should still try to parse it and may succeed or fail depending on validation
            # If it fails to parse, it should return an error
            assert isinstance(result, (JSONRPCResponse, JSONRPCError))
            if isinstance(result, JSONRPCError):
                assert result.error.code == INTERNAL_ERROR
                assert "Failed to parse success response" in result.error.message

    def test_malformed_error_response(self, handler, mock_context):
        """Test handling of malformed error response from adapter."""
        request = JSONRPCRequest(
            jsonrpc="2.0",
            method="test",
            id=13
        )

        # Mock the stdio_server_adapter to return a malformed error response
        mock_response = {
            "jsonrpc": "2.0",
            "error": "should be an object, not a string",
            "id": 13
        }

        with patch(
            'mcp_lambda.server_adapter.stdio_server_adapter_request_handler.stdio_server_adapter'
        ) as mock_adapter:
            mock_adapter.return_value = mock_response

            result = handler.handle_request(request, mock_context)

            # Verify the result is a JSONRPCError (our fallback error)
            assert isinstance(result, JSONRPCError)
            assert result.jsonrpc == "2.0"
            assert result.error.code == INTERNAL_ERROR
            assert "Failed to parse error response" in result.error.message
            assert result.id == 13
