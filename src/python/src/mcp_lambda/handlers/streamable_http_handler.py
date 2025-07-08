"""
Abstract base class for MCP Streamable HTTP protocol handlers in Lambda functions.

This module handles all the generic JSON-RPC protocol aspects:
- HTTP method validation (POST, OPTIONS, GET)
- Content-Type and Accept header validation
- JSON parsing and validation
- Batch request handling
- CORS headers
- Error response formatting

The specific business logic is delegated to a RequestHandler implementation.
Event-specific parsing and response formatting is handled by concrete subclasses.
"""

import json
import logging
from abc import ABC, abstractmethod
from typing import Any, Dict, Generic, List, Optional, TypeVar, Union

from aws_lambda_typing.context import Context as LambdaContext
from mcp.types import (
    CONNECTION_CLOSED,
    INTERNAL_ERROR,
    INVALID_REQUEST,
    PARSE_ERROR,
    ErrorData,
    JSONRPCError,
    JSONRPCMessage,
    JSONRPCRequest,
    JSONRPCResponse,
)
from pydantic import ValidationError

from .request_handler import RequestHandler

# Set up logging
logger = logging.getLogger(__name__)

# Type variables for generic event and result types
TEvent = TypeVar("TEvent")
TResult = TypeVar("TResult")


class ParsedHttpRequest:
    """Parsed HTTP request data extracted from various Lambda event types."""

    def __init__(
        self, method: str, headers: Dict[str, Optional[str]], body: Optional[str]
    ):
        self.method = method
        self.headers = headers
        self.body = body


class HttpResponse:
    """HTTP response data that can be formatted for different Lambda event types."""

    def __init__(self, status_code: int, headers: Dict[str, str], body: str):
        self.status_code = status_code
        self.headers = headers
        self.body = body


class StreamableHttpHandler(ABC, Generic[TEvent, TResult]):
    """
    Abstract base class for MCP Streamable HTTP protocol handlers in Lambda functions.

    This class handles all the generic JSON-RPC protocol aspects:
    - HTTP method validation (POST, OPTIONS, GET)
    - Content-Type and Accept header validation
    - JSON parsing and validation
    - Batch request handling
    - CORS headers
    - Error response formatting
    This class does not implement session management.

    The specific business logic is delegated to a RequestHandler implementation.
    Event-specific parsing and response formatting is handled by concrete subclasses.
    """

    def __init__(self, request_handler: RequestHandler):
        self.request_handler = request_handler

    def handle(self, event: TEvent, context: LambdaContext) -> TResult:
        """
        Main handler method that processes Lambda events.
        Concrete implementations should call this after parsing the event.
        """
        try:
            logger.debug("Incoming event: %s", json.dumps(event, default=str, indent=2))

            # Parse the event into a common HTTP request format
            http_request = self.parse_event(event)

            # Process the HTTP request using shared logic
            http_response = self.process_http_request(http_request, context)

            # Format the response for the specific event type
            return self.format_response(http_response)
        except Exception as error:
            logger.error(
                "Error processing MCP Streamable HTTP request: %s", error, exc_info=True
            )

            return self.format_response(
                self.create_error_http_response(
                    500,
                    INTERNAL_ERROR,
                    "Internal error",
                    {},
                    str(error) if error else "Unknown error",
                )
            )

    @abstractmethod
    def parse_event(self, event: TEvent) -> ParsedHttpRequest:
        """
        Parse the Lambda event into a common HTTP request format.
        Must be implemented by concrete subclasses.
        """
        pass

    @abstractmethod
    def format_response(self, response: HttpResponse) -> TResult:
        """
        Format the HTTP response for the specific Lambda event type.
        Must be implemented by concrete subclasses.
        """
        pass

    def process_http_request(
        self, http_request: ParsedHttpRequest, context: LambdaContext
    ) -> HttpResponse:
        """Process the HTTP request using shared MCP Streamable HTTP logic."""
        # Handle different HTTP methods according to MCP Streamable HTTP spec
        logger.debug("Detected HTTP method: %s", http_request.method)

        if http_request.method == "OPTIONS":
            # Handle CORS preflight
            return self.create_cors_http_response()

        if http_request.method == "GET":
            # No support for SSE streaming in Lambda functions
            # Return 405 Method Not Allowed as per spec
            return self.create_error_http_response(
                405,
                CONNECTION_CLOSED,
                "Method Not Allowed: SSE streaming not supported",
                {"Allow": "POST, OPTIONS"},
            )

        if http_request.method != "POST":
            return self.create_error_http_response(
                405, CONNECTION_CLOSED, "Method Not Allowed", {"Allow": "POST, OPTIONS"}
            )

        # Validate Accept header for POST requests
        accept_header = self.get_header_value(http_request.headers, "accept")
        if not accept_header or "application/json" not in accept_header:
            return self.create_error_http_response(
                406,
                CONNECTION_CLOSED,
                "Not Acceptable: Client must accept application/json",
            )

        # Validate Content-Type header
        content_type = self.get_header_value(http_request.headers, "content-type")
        if not content_type or "application/json" not in content_type:
            return self.create_error_http_response(
                415,
                CONNECTION_CLOSED,
                "Unsupported Media Type: Content-Type must be application/json",
            )

        # Parse the request body according to MCP Streamable HTTP spec
        if not http_request.body:
            return self.create_error_http_response(
                400, PARSE_ERROR, "Parse error: Empty request body"
            )

        try:
            parsed_body = json.loads(http_request.body)
        except json.JSONDecodeError:
            return self.create_error_http_response(
                400, PARSE_ERROR, "Parse error: Invalid JSON"
            )

        # Handle both single messages and batches according to MCP spec
        is_batch_request = isinstance(parsed_body, list)
        if is_batch_request:
            messages = parsed_body
        else:
            messages = [parsed_body]

        # Validate that all messages are valid JSON-RPC using schema validation
        validated_messages: List[JSONRPCMessage] = []
        for message in messages:
            try:
                validated_message = JSONRPCMessage.model_validate(message)
                validated_messages.append(validated_message)
            except ValidationError:
                return self.create_error_http_response(
                    400,
                    INVALID_REQUEST,
                    "Invalid Request: All messages must be valid JSON-RPC 2.0",
                )

        # Check if any message is a request (vs notification/response)
        has_requests = any(
            isinstance(msg.root, JSONRPCRequest) for msg in validated_messages
        )

        if not has_requests:
            # If it only contains notifications or responses, return 202 Accepted
            return HttpResponse(
                status_code=202, headers={"Access-Control-Allow-Origin": "*"}, body=""
            )

        # Process requests - for Lambda, we'll process them sequentially and return JSON
        responses: List[Union[JSONRPCResponse, JSONRPCError]] = []

        for message in validated_messages:
            if isinstance(message.root, JSONRPCRequest):
                try:
                    # Delegate to the specific request handler
                    response = self.request_handler.handle_request(
                        message.root, context
                    )

                    # The handler should return JSONRPCResponse or JSONRPCError for requests
                    if isinstance(response, (JSONRPCResponse, JSONRPCError)):
                        responses.append(response)
                    else:
                        # Unexpected response format - return internal server error
                        logger.error(
                            "Unexpected response format from request handler: %s",
                            response,
                        )
                        error_response = JSONRPCError(
                            jsonrpc="2.0",
                            error=ErrorData(
                                code=INTERNAL_ERROR,
                                message="Internal error: Unexpected response format from request handler",
                                data="Expected JSONRPCResponse or JSONRPCError",
                            ),
                            id=message.root.id,
                        )
                        responses.append(error_response)
                except Exception as error:
                    # Return JSON-RPC error response
                    error_response = JSONRPCError(
                        jsonrpc="2.0",
                        error=ErrorData(
                            code=INTERNAL_ERROR,
                            message="Internal error",
                            data=str(error) if error else "Unknown error",
                        ),
                        id=message.root.id,
                    )
                    responses.append(error_response)

        # Prepare response headers
        response_headers = {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version",
        }

        # Return the response(s)
        # For batch requests, always return an array even if there's only one response
        # For single requests, return a single object
        if is_batch_request:
            response_body = [
                r.model_dump(by_alias=True, exclude_none=True) for r in responses
            ]
        else:
            # Single request - return single response object
            if len(responses) == 1:
                response_body = responses[0].model_dump(by_alias=True, exclude_none=True)
            else:
                # This shouldn't happen for single requests, but handle gracefully
                response_body = [
                    r.model_dump(by_alias=True, exclude_none=True) for r in responses
                ]

        return HttpResponse(
            status_code=200, headers=response_headers, body=json.dumps(response_body)
        )

    def get_header_value(
        self, headers: Dict[str, Optional[str]], header_name: str
    ) -> Optional[str]:
        """Get header value in a case-insensitive way."""
        # Try exact match first
        if header_name in headers:
            return headers[header_name]

        # Try case-insensitive match
        lower_header_name = header_name.lower()
        for key, value in headers.items():
            if key.lower() == lower_header_name:
                return value

        return None

    def create_cors_http_response(self) -> HttpResponse:
        """Create a CORS preflight HTTP response."""
        return HttpResponse(
            status_code=200,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version",
            },
            body="",
        )

    def create_error_http_response(
        self,
        status_code: int,
        error_code: int,
        message: str,
        additional_headers: Optional[Dict[str, str]] = None,
        data: Optional[Any] = None,
    ) -> HttpResponse:
        """Create an error HTTP response with proper CORS headers."""
        headers = {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        }
        if additional_headers:
            headers.update(additional_headers)

        error_response = self.create_jsonrpc_error_response(error_code, message, data)

        return HttpResponse(
            status_code=status_code, headers=headers, body=json.dumps(error_response)
        )

    def create_jsonrpc_error_response(
        self, code: int, message: str, data: Optional[Any] = None
    ) -> Dict[str, Any]:
        """Helper function to create JSON-RPC error responses with no ID."""
        error_response = {
            "jsonrpc": "2.0",
            "error": {
                "code": code,
                "message": message,
            },
            "id": None,
        }

        if data is not None:
            error_response["error"]["data"] = data

        return error_response
