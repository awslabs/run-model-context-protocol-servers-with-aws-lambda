from abc import ABC, abstractmethod
from typing import Union

from aws_lambda_typing.context import Context as LambdaContext
from mcp.types import JSONRPCError, JSONRPCRequest, JSONRPCResponse


class RequestHandler(ABC):
    """
    Interface for handling individual JSON-RPC requests.

    This interface defines the contract for processing MCP (Model Context Protocol) requests
    in AWS Lambda functions. Implementations should contain the business logic for handling
    specific JSON-RPC methods.
    """

    @abstractmethod
    def handle_request(
        self, request: JSONRPCRequest, context: LambdaContext
    ) -> Union[JSONRPCResponse, JSONRPCError]:
        """
        Process a single JSON-RPC request and return a response or error.

        Args:
            request: The JSON-RPC request to process
            context: The AWS Lambda context providing runtime information

        Returns:
            A JSON-RPC response (for successful requests) or a JSON-RPC error (for failed requests)

        Example:
            ```python
            def handle_request(
                self, request: JSONRPCRequest, context: LambdaContext
            ) -> Union[JSONRPCResponse, JSONRPCError]:
                if request.method == "ping":
                    return JSONRPCResponse(
                        jsonrpc="2.0",
                        result={"message": "pong"},
                        id=request.id,
                    )
                else:
                    return JSONRPCError(
                        jsonrpc="2.0",
                        error=ErrorData(
                            code=-32601,
                            message="Method not found",
                        ),
                        id=request.id,
                    )
            ```
        """
        pass
