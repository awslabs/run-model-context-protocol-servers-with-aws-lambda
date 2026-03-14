from typing import Any, Dict

from aws_lambda_powertools.utilities.typing import LambdaContext
from mcp.types import JSONRPCError, JSONRPCRequest

from .request_handler import RequestHandler


class BedrockAgentCoreGatewayTargetHandler:
    """
    Handler for Bedrock AgentCore Gateway Lambda targets

    This handler processes direct Lambda invocations from Bedrock AgentCore Gateway.
    Bedrock AgentCore Gateway passes tool arguments directly in the event and
    provides metadata through the Lambda context's client_context.custom properties.
    """

    def __init__(self, request_handler: RequestHandler):
        self.request_handler = request_handler

    def handle(self, event: Dict[str, Any], context: LambdaContext) -> Any:
        """Handle Lambda invocation from Bedrock AgentCore Gateway"""
        # Extract tool metadata from context
        gateway_tool_name = None

        if context.client_context and hasattr(context.client_context, "custom"):
            gateway_tool_name = context.client_context.custom.get(
                "bedrockAgentCoreToolName"
            )

        if not gateway_tool_name:
            raise ValueError("Missing bedrockAgentCoreToolName in context")

        # Gateway names the tools like <target name>___<tool name>
        parts = gateway_tool_name.split("___", 1)
        if len(parts) != 2 or not parts[1]:
            raise ValueError(f"Invalid tool name format: {gateway_tool_name}")
        tool_name = parts[1]

        # Create JSON-RPC request from gateway event
        jsonrpc_request = JSONRPCRequest(
            jsonrpc="2.0",
            id=1,
            method="tools/call",
            params={
                "name": tool_name,
                "arguments": event,
            },
        )

        result = self.request_handler.handle_request(jsonrpc_request, context)

        if isinstance(result, JSONRPCError):
            raise Exception(result.error.message)

        return result.result
