from typing import Dict, Optional, TypedDict

from aws_lambda_typing.events import APIGatewayProxyEventV2

from .request_handler import RequestHandler
from .streamable_http_handler import (
    HttpResponse,
    ParsedHttpRequest,
    StreamableHttpHandler,
)


class APIGatewayProxyResultV2(TypedDict):
    """API Gateway Proxy V2 Result type."""

    statusCode: int
    headers: Dict[str, str]
    body: str


class APIGatewayProxyEventV2Handler(
    StreamableHttpHandler[APIGatewayProxyEventV2, APIGatewayProxyResultV2]
):
    """
    Handler for API Gateway V2 events (HTTP APIs).

    This handler processes APIGatewayProxyEventV2 events and returns APIGatewayProxyResultV2 responses.

    This class handles all the generic JSON-RPC protocol aspects of the MCP Streamable HTTP transport:
    - HTTP method validation (POST, OPTIONS, GET)
    - Content-Type and Accept header validation
    - JSON parsing and validation
    - Batch request handling
    - CORS headers
    - Error response formatting
    This class does not implement session management.

    The specific business logic is delegated to a provided RequestHandler implementation.
    """

    def __init__(self, request_handler: RequestHandler):
        super().__init__(request_handler)

    def parse_event(self, event: APIGatewayProxyEventV2) -> ParsedHttpRequest:
        """Parse API Gateway V2 event (APIGatewayProxyEventV2) into common HTTP request format."""
        # Safely access nested optional fields
        method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
        headers = event.get("headers") or {}
        # Ensure headers are Dict[str, Optional[str]] as expected by ParsedHttpRequest
        normalized_headers: Dict[str, Optional[str]] = dict(headers)
        
        return ParsedHttpRequest(
            method=method,
            headers=normalized_headers,
            body=event.get("body"),
        )

    def format_response(self, response: HttpResponse) -> APIGatewayProxyResultV2:
        """Format HTTP response as APIGatewayProxyResultV2."""
        return {
            "statusCode": response.status_code,
            "headers": response.headers,
            "body": response.body,
        }
