from typing import Dict, Optional, TypedDict

from aws_lambda_typing.events import APIGatewayProxyEventV1 as APIGatewayProxyEvent

from .request_handler import RequestHandler
from .streamable_http_handler import (
    HttpResponse,
    ParsedHttpRequest,
    StreamableHttpHandler,
)


class APIGatewayProxyResult(TypedDict):
    """API Gateway Proxy Result type."""

    statusCode: int
    headers: Dict[str, str]
    body: str


class APIGatewayProxyEventHandler(
    StreamableHttpHandler[APIGatewayProxyEvent, APIGatewayProxyResult]
):
    """
    Handler for API Gateway V1 events (REST APIs).

    This handler processes APIGatewayProxyEvent events (Lambda proxy integration behind API Gateway REST API)
    and returns APIGatewayProxyResult responses.

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

    def parse_event(self, event: APIGatewayProxyEvent) -> ParsedHttpRequest:
        """Parse APIGatewayProxyEvent into common HTTP request format."""
        headers = event.get("headers") or {}
        # Ensure headers are Dict[str, Optional[str]] as expected by ParsedHttpRequest
        normalized_headers: Dict[str, Optional[str]] = dict(headers)
        
        return ParsedHttpRequest(
            method=event["httpMethod"],
            headers=normalized_headers,
            body=event.get("body"),
        )

    def format_response(self, response: HttpResponse) -> APIGatewayProxyResult:
        """Format HTTP response as APIGatewayProxyResult."""
        return {
            "statusCode": response.status_code,
            "headers": response.headers,
            "body": response.body,
        }
