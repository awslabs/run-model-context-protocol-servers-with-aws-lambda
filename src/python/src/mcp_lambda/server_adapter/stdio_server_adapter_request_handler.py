import logging
from typing import Union

from aws_lambda_typing.context import Context as LambdaContext
from mcp.client.stdio import StdioServerParameters
from mcp.types import (
    INTERNAL_ERROR,
    ErrorData,
    JSONRPCError,
    JSONRPCRequest,
    JSONRPCResponse,
)

from ..handlers.request_handler import RequestHandler
from .adapter import stdio_server_adapter

# Set up logging
logger = logging.getLogger(__name__)


class StdioServerAdapterRequestHandler(RequestHandler):
    """
    Generic Request Handler for MCP Stdio Server Adapter.

    This class provides a reusable implementation of the RequestHandler interface
    that delegates JSON-RPC requests to an MCP server via the stdio server adapter.

    The handler starts an MCP server as a child process for each request, forwards
    the JSON-RPC request to the server, and returns the server's response. The server
    is automatically started and shut down for each function invocation.

    Usage:
    ```python
    from mcp.client.stdio import StdioServerParameters
    from mcp_lambda.server_adapter import StdioServerAdapterRequestHandler
    from mcp_lambda.handlers import APIGatewayProxyEventHandler

    server_params = StdioServerParameters(
        command="python",
        args=["-m", "my_mcp_server", "--option", "value"]
    )

    request_handler = StdioServerAdapterRequestHandler(server_params)
    lambda_handler = APIGatewayProxyEventHandler(request_handler)

    def handler(event, context):
        return lambda_handler.handle(event, context)
    ```
    """

    def __init__(self, server_params: StdioServerParameters):
        """
        Initialize the stdio server adapter request handler.

        Args:
            server_params: Configuration for the stdio server (command, args, etc.)
        """
        self.server_params = server_params

    def handle_request(
        self, request: JSONRPCRequest, context: LambdaContext
    ) -> Union[JSONRPCResponse, JSONRPCError]:
        """
        Handle a JSON-RPC request by delegating to the MCP stdio server.

        Args:
            request: The JSON-RPC request to process
            context: The AWS Lambda context providing runtime information

        Returns:
            A JSON-RPC response (for successful requests) or a JSON-RPC error (for failed requests)
        """
        try:
            logger.debug(
                "Delegating request to stdio server adapter: %s", request.method
            )

            # Convert the request to a dictionary for the adapter
            request_dict = request.model_dump(by_alias=True, exclude_none=True)

            # Call the MCP server adapter with the individual request
            # The stdio_server_adapter is synchronous and handles its own event loop
            mcp_response = stdio_server_adapter(
                self.server_params, request_dict, context
            )

            # The stdio_server_adapter returns a dictionary, so we need to validate and convert it
            if isinstance(mcp_response, dict):
                # Check if it's an error response
                if "error" in mcp_response:
                    try:
                        return JSONRPCError.model_validate(mcp_response)
                    except Exception as e:
                        logger.error(
                            "Failed to parse error response from stdio server: %s", e
                        )
                        return JSONRPCError(
                            jsonrpc="2.0",
                            error=ErrorData(
                                code=INTERNAL_ERROR,
                                message="Internal error: Failed to parse error response from MCP server",
                                data=str(e),
                            ),
                            id=request.id,
                        )
                # Check if it's a success response
                elif "result" in mcp_response:
                    try:
                        return JSONRPCResponse.model_validate(mcp_response)
                    except Exception as e:
                        logger.error(
                            "Failed to parse success response from stdio server: %s", e
                        )
                        return JSONRPCError(
                            jsonrpc="2.0",
                            error=ErrorData(
                                code=INTERNAL_ERROR,
                                message="Internal error: Failed to parse success response from MCP server",
                                data=str(e),
                            ),
                            id=request.id,
                        )
                else:
                    # Unexpected response format
                    logger.error(
                        "Unexpected response format from stdio server adapter: %s",
                        mcp_response,
                    )
                    return JSONRPCError(
                        jsonrpc="2.0",
                        error=ErrorData(
                            code=INTERNAL_ERROR,
                            message="Internal error: Unexpected response format from MCP server",
                            data="Expected response with 'result' or 'error' field",
                        ),
                        id=request.id,
                    )
            else:
                # Non-dictionary response
                logger.error(
                    "Non-dictionary response from stdio server adapter: %s",
                    type(mcp_response),
                )
                return JSONRPCError(
                    jsonrpc="2.0",
                    error=ErrorData(
                        code=INTERNAL_ERROR,
                        message="Internal error: Invalid response type from MCP server",
                        data=f"Expected dictionary, got {type(mcp_response)}",
                    ),
                    id=request.id,
                )

        except Exception as error:
            logger.error(
                "Exception in stdio server adapter request handler: %s",
                error,
                exc_info=True,
            )
            # Return JSON-RPC error response
            return JSONRPCError(
                jsonrpc="2.0",
                error=ErrorData(
                    code=INTERNAL_ERROR,
                    message="Internal error",
                    data=str(error) if error else "Unknown error",
                ),
                id=request.id,
            )
