"""
Tests for MCP Lambda handlers.
"""

import json
from typing import Union
from unittest.mock import Mock

import pytest
from aws_lambda_typing.context import Context as LambdaContext
from mcp.types import (
    INTERNAL_ERROR,
    METHOD_NOT_FOUND,
    ErrorData,
    JSONRPCError,
    JSONRPCRequest,
    JSONRPCResponse,
)

from mcp_lambda.handlers import (
    APIGatewayProxyEventHandler,
    APIGatewayProxyEventV2Handler,
    LambdaFunctionURLEventHandler,
    RequestHandler,
)


class TestRequestHandler(RequestHandler):
    """Test implementation of RequestHandler."""

    def handle_request(
        self, request: JSONRPCRequest, context: LambdaContext
    ) -> Union[JSONRPCResponse, JSONRPCError]:
        """Handle test requests."""
        if request.method == "ping":
            return JSONRPCResponse(
                jsonrpc="2.0",
                result={"message": "pong"},
                id=request.id,
            )
        elif request.method == "error":
            return JSONRPCError(
                jsonrpc="2.0",
                error=ErrorData(
                    code=INTERNAL_ERROR,
                    message="Test error",
                ),
                id=request.id,
            )
        else:
            return JSONRPCError(
                jsonrpc="2.0",
                error=ErrorData(
                    code=METHOD_NOT_FOUND,
                    message="Method not found",
                ),
                id=request.id,
            )


@pytest.fixture
def mock_context():
    """Create a mock Lambda context."""
    context = Mock(spec=LambdaContext)
    context.function_name = "test-function"
    context.function_version = "1"
    context.invoked_function_arn = (
        "arn:aws:lambda:us-east-1:123456789012:function:test-function"
    )
    context.memory_limit_in_mb = 128
    context.remaining_time_in_millis = lambda: 30000
    context.request_id = "test-request-id"
    context.log_group_name = "/aws/lambda/test-function"
    context.log_stream_name = "2023/01/01/[$LATEST]test-stream"
    return context


@pytest.fixture
def test_request_handler():
    """Create a test request handler."""
    return TestRequestHandler()


class BaseHandlerTests:
    """Base class containing shared test methods for all handler types."""

    def get_handler(self, test_request_handler):
        """Override in subclasses to return the specific handler type."""
        raise NotImplementedError("Subclasses must implement get_handler")

    def create_event(self, method="POST", headers=None, body=None):
        """Override in subclasses to create the appropriate event type."""
        raise NotImplementedError("Subclasses must implement create_event")

    # HTTP Methods Tests
    def test_options_request_cors_preflight(self, test_request_handler, mock_context):
        """Should handle OPTIONS request (CORS preflight)."""
        handler = self.get_handler(test_request_handler)
        event = self.create_event("OPTIONS")
        result = handler.handle(event, mock_context)

        assert result["statusCode"] == 200
        assert result["headers"]["Access-Control-Allow-Origin"] == "*"
        assert result["headers"]["Access-Control-Allow-Methods"] == "POST, GET, OPTIONS"
        assert result["body"] == ""

    def test_get_request_returns_405(self, test_request_handler, mock_context):
        """Should return 405 for GET requests."""
        handler = self.get_handler(test_request_handler)
        event = self.create_event("GET")
        result = handler.handle(event, mock_context)

        assert result["statusCode"] == 405
        assert result["headers"]["Allow"] == "POST, OPTIONS"

    def test_put_request_returns_405(self, test_request_handler, mock_context):
        """Should return 405 for PUT requests."""
        handler = self.get_handler(test_request_handler)
        event = self.create_event("PUT")
        result = handler.handle(event, mock_context)

        assert result["statusCode"] == 405
        assert result["headers"]["Allow"] == "POST, OPTIONS"

    def test_patch_request_returns_405(self, test_request_handler, mock_context):
        """Should return 405 for PATCH requests."""
        handler = self.get_handler(test_request_handler)
        event = self.create_event("PATCH")
        result = handler.handle(event, mock_context)

        assert result["statusCode"] == 405
        assert result["headers"]["Allow"] == "POST, OPTIONS"

    def test_delete_request_returns_405(self, test_request_handler, mock_context):
        """Should return 405 for DELETE requests."""
        handler = self.get_handler(test_request_handler)
        event = self.create_event("DELETE")
        result = handler.handle(event, mock_context)

        assert result["statusCode"] == 405
        assert result["headers"]["Allow"] == "POST, OPTIONS"

    # Header Validation Tests
    def test_missing_all_headers_returns_406(self, test_request_handler, mock_context):
        """Should return 406 when missing all headers."""
        handler = self.get_handler(test_request_handler)
        event = self.create_event(
            "POST", {}, '{"jsonrpc": "2.0", "method": "ping", "id": 1}'
        )
        result = handler.handle(event, mock_context)

        assert result["statusCode"] == 406

    def test_missing_accept_header_returns_406(
        self, test_request_handler, mock_context
    ):
        """Should return 406 for missing Accept header."""
        handler = self.get_handler(test_request_handler)
        event = self.create_event(
            "POST",
            {"Content-Type": "application/json"},
            '{"jsonrpc": "2.0", "method": "ping", "id": 1}',
        )
        result = handler.handle(event, mock_context)

        assert result["statusCode"] == 406

    def test_wrong_accept_content_type_returns_406(
        self, test_request_handler, mock_context
    ):
        """Should return 406 for wrong Accept content type."""
        handler = self.get_handler(test_request_handler)
        event = self.create_event(
            "POST",
            {"Content-Type": "application/json", "Accept": "text/html"},
            '{"jsonrpc": "2.0", "method": "ping", "id": 1}',
        )
        result = handler.handle(event, mock_context)

        assert result["statusCode"] == 406

    def test_missing_content_type_returns_415(self, test_request_handler, mock_context):
        """Should return 415 for missing Content-Type."""
        handler = self.get_handler(test_request_handler)
        event = self.create_event(
            "POST",
            {"Accept": "application/json"},
            '{"jsonrpc": "2.0", "method": "ping", "id": 1}',
        )
        result = handler.handle(event, mock_context)

        assert result["statusCode"] == 415

    def test_wrong_content_type_returns_415(self, test_request_handler, mock_context):
        """Should return 415 for wrong Content-Type."""
        handler = self.get_handler(test_request_handler)
        event = self.create_event(
            "POST",
            {"Accept": "application/json", "Content-Type": "text/plain"},
            '{"jsonrpc": "2.0", "method": "ping", "id": 1}',
        )
        result = handler.handle(event, mock_context)

        assert result["statusCode"] == 415

    def test_case_insensitive_headers(self, test_request_handler, mock_context):
        """Should accept case-insensitive headers."""
        handler = self.get_handler(test_request_handler)
        event = self.create_event(
            "POST",
            {"content-type": "application/json", "ACCEPT": "application/json"},
            '{"jsonrpc": "2.0", "method": "ping", "id": 1}',
        )
        result = handler.handle(event, mock_context)

        assert result["statusCode"] == 200

    # Request Body Validation Tests
    def test_empty_request_body_returns_400(self, test_request_handler, mock_context):
        """Should return 400 for empty request body."""
        handler = self.get_handler(test_request_handler)
        event = self.create_event(
            "POST",
            {"Content-Type": "application/json", "Accept": "application/json"},
            "",
        )
        result = handler.handle(event, mock_context)

        assert result["statusCode"] == 400

    def test_invalid_json_returns_400(self, test_request_handler, mock_context):
        """Should return 400 for invalid JSON."""
        handler = self.get_handler(test_request_handler)
        event = self.create_event(
            "POST",
            {"Content-Type": "application/json", "Accept": "application/json"},
            "{invalid json",
        )
        result = handler.handle(event, mock_context)

        assert result["statusCode"] == 400

    def test_invalid_jsonrpc_format_returns_400(
        self, test_request_handler, mock_context
    ):
        """Should return 400 for invalid JSON-RPC message format."""
        handler = self.get_handler(test_request_handler)
        event = self.create_event(
            "POST",
            {"Content-Type": "application/json", "Accept": "application/json"},
            '{"not": "jsonrpc"}',
        )
        result = handler.handle(event, mock_context)

        assert result["statusCode"] == 400

    # Single Request Handling Tests
    def test_valid_jsonrpc_request(self, test_request_handler, mock_context):
        """Should handle valid JSON-RPC request and return response."""
        handler = self.get_handler(test_request_handler)
        event = self.create_event(
            "POST",
            {"Content-Type": "application/json", "Accept": "application/json"},
            '{"jsonrpc": "2.0", "method": "ping", "id": 1}',
        )
        result = handler.handle(event, mock_context)

        assert result["statusCode"] == 200
        assert result["headers"]["Content-Type"] == "application/json"

        response_body = json.loads(result["body"])
        assert response_body["jsonrpc"] == "2.0"
        assert response_body["result"]["message"] == "pong"
        assert response_body["id"] == 1

    def test_jsonrpc_error_from_handler(self, test_request_handler, mock_context):
        """Should handle JSON-RPC errors from request handler."""
        handler = self.get_handler(test_request_handler)
        event = self.create_event(
            "POST",
            {"Content-Type": "application/json", "Accept": "application/json"},
            '{"jsonrpc": "2.0", "method": "error", "id": 1}',
        )
        result = handler.handle(event, mock_context)

        assert result["statusCode"] == 200
        response_body = json.loads(result["body"])
        assert response_body["jsonrpc"] == "2.0"
        assert "error" in response_body
        assert response_body["id"] == 1

    def test_exception_from_handler(self, test_request_handler, mock_context):
        """Should handle exceptions from request handler."""

        # Create a handler that throws an exception
        class ExceptionHandler(TestRequestHandler):
            def handle_request(self, request, context):
                raise ValueError("Test exception")

        exception_handler = self.get_handler(ExceptionHandler())
        event = self.create_event(
            "POST",
            {"Content-Type": "application/json", "Accept": "application/json"},
            '{"jsonrpc": "2.0", "method": "ping", "id": 1}',
        )
        result = exception_handler.handle(event, mock_context)

        assert result["statusCode"] == 200
        response_body = json.loads(result["body"])
        assert response_body["jsonrpc"] == "2.0"
        assert "error" in response_body

    def test_unexpected_response_format_from_handler(
        self, test_request_handler, mock_context
    ):
        """Should handle unexpected response format from request handler."""

        # Create a handler that returns unexpected format
        class BadHandler(TestRequestHandler):
            def handle_request(self, request, context):  # pyright: ignore
                return "not a valid response"

        bad_handler = self.get_handler(BadHandler())
        event = self.create_event(
            "POST",
            {"Content-Type": "application/json", "Accept": "application/json"},
            '{"jsonrpc": "2.0", "method": "ping", "id": 1}',
        )
        result = bad_handler.handle(event, mock_context)

        assert result["statusCode"] == 200
        response_body = json.loads(result["body"])
        assert response_body["jsonrpc"] == "2.0"
        assert "error" in response_body

    def test_notification_returns_202(self, test_request_handler, mock_context):
        """Should return 202 for notification event."""
        handler = self.get_handler(test_request_handler)
        event = self.create_event(
            "POST",
            {"Content-Type": "application/json", "Accept": "application/json"},
            '{"jsonrpc": "2.0", "method": "ping"}',
        )
        result = handler.handle(event, mock_context)

        assert result["statusCode"] == 202
        assert result["body"] == ""

    # Batch Request Handling Tests
    def test_batch_requests(self, test_request_handler, mock_context):
        """Should handle batch of requests."""
        handler = self.get_handler(test_request_handler)
        batch_body = '[{"jsonrpc": "2.0", "method": "ping", "id": 1}, {"jsonrpc": "2.0", "method": "ping", "id": 2}]'
        event = self.create_event(
            "POST",
            {"Content-Type": "application/json", "Accept": "application/json"},
            batch_body,
        )
        result = handler.handle(event, mock_context)

        assert result["statusCode"] == 200
        response_body = json.loads(result["body"])
        assert isinstance(response_body, list)
        assert len(response_body) == 2

    def test_mixed_batch_requests_notifications(
        self, test_request_handler, mock_context
    ):
        """Should handle mixed batch with requests and notifications."""
        handler = self.get_handler(test_request_handler)
        batch_body = '[{"jsonrpc": "2.0", "method": "ping", "id": 1}, {"jsonrpc": "2.0", "method": "ping"}]'
        event = self.create_event(
            "POST",
            {"Content-Type": "application/json", "Accept": "application/json"},
            batch_body,
        )
        result = handler.handle(event, mock_context)

        assert result["statusCode"] == 200
        response_body = json.loads(result["body"])
        assert isinstance(response_body, list)
        assert len(response_body) == 1  # Only the request gets a response

    def test_batch_notifications_only_returns_202(
        self, test_request_handler, mock_context
    ):
        """Should return 202 for batch of notifications only."""
        handler = self.get_handler(test_request_handler)
        batch_body = '[{"jsonrpc": "2.0", "method": "ping"}, {"jsonrpc": "2.0", "method": "ping"}]'
        event = self.create_event(
            "POST",
            {"Content-Type": "application/json", "Accept": "application/json"},
            batch_body,
        )
        result = handler.handle(event, mock_context)

        assert result["statusCode"] == 202
        assert result["body"] == ""


class TestAPIGatewayProxyEventHandler(BaseHandlerTests):
    """Tests for APIGatewayProxyEventHandler."""

    def get_handler(self, test_request_handler):
        """Create handler instance."""
        return APIGatewayProxyEventHandler(test_request_handler)

    def create_event(self, method="POST", headers=None, body=None):
        """Helper to create base API Gateway event."""
        return {
            "httpMethod": method,
            "headers": headers or {},
            "multiValueHeaders": {},
            "body": body,
            "resource": "/test",
            "path": "/test",
            "pathParameters": None,
            "queryStringParameters": None,
            "multiValueQueryStringParameters": {},
            "stageVariables": None,
            "requestContext": {
                "accountId": "123456789012",
                "apiId": "test-api",
                "httpMethod": method,
                "requestId": "test-request",
                "resourceId": "test-resource",
                "resourcePath": "/test",
                "stage": "test",
                "identity": {
                    "sourceIp": "127.0.0.1",
                    "userAgent": "test-agent",
                },
            },
            "isBase64Encoded": False,
        }


class TestAPIGatewayProxyEventV2Handler(BaseHandlerTests):
    """Tests for APIGatewayProxyEventV2Handler."""

    def get_handler(self, test_request_handler):
        """Create handler instance."""
        return APIGatewayProxyEventV2Handler(test_request_handler)

    def create_event(self, method="POST", headers=None, body=None):
        """Helper to create base API Gateway V2 event."""
        return {
            "version": "2.0",
            "routeKey": f"{method} /test",
            "rawPath": "/test",
            "rawQueryString": "",
            "headers": headers or {},
            "body": body,
            "requestContext": {
                "accountId": "123456789012",
                "apiId": "test-api",
                "domainName": "test.execute-api.us-east-1.amazonaws.com",
                "domainPrefix": "test",
                "http": {
                    "method": method,
                    "path": "/test",
                    "protocol": "HTTP/1.1",
                    "sourceIp": "127.0.0.1",
                    "userAgent": "test-agent",
                },
                "requestId": "test-request",
                "routeKey": f"{method} /test",
                "stage": "$default",
                "time": "01/Jan/2023:00:00:00 +0000",
                "timeEpoch": 1672531200,
            },
            "isBase64Encoded": False,
        }


class TestLambdaFunctionURLEventHandler(BaseHandlerTests):
    """Tests for LambdaFunctionURLEventHandler."""

    def get_handler(self, test_request_handler):
        """Create handler instance."""
        return LambdaFunctionURLEventHandler(test_request_handler)

    def create_event(self, method="POST", headers=None, body=None):
        """Helper to create base Lambda Function URL event."""
        return {
            "version": "2.0",
            "routeKey": "$default",
            "rawPath": "/",
            "rawQueryString": "",
            "headers": headers or {},
            "body": body,
            "requestContext": {
                "accountId": "123456789012",
                "apiId": "test-function-url",
                "domainName": "test-function-url.lambda-url.us-east-1.on.aws",
                "domainPrefix": "test-function-url",
                "http": {
                    "method": method,
                    "path": "/",
                    "protocol": "HTTP/1.1",
                    "sourceIp": "127.0.0.1",
                    "userAgent": "test-agent",
                },
                "requestId": "test-request",
                "routeKey": "$default",
                "stage": "$default",
                "time": "01/Jan/2023:00:00:00 +0000",
                "timeEpoch": 1672531200,
            },
            "isBase64Encoded": False,
        }
