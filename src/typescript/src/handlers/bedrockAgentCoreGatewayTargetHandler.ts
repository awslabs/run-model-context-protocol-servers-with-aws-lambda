import { Context } from "aws-lambda";
import {
  JSONRPCRequest,
  isJSONRPCError,
} from "@modelcontextprotocol/sdk/types.js";
import { RequestHandler } from "./requestHandler.js";

/**
 * Handler for Bedrock AgentCore Gateway Lambda targets
 *
 * This handler processes direct Lambda invocations from Bedrock AgentCore Gateway.
 * Bedrock AgentCore Gateway passes tool arguments directly in the event and
 * provides metadata through the Lambda context's client_context.custom properties.
 */
export class BedrockAgentCoreGatewayTargetHandler {
  constructor(private requestHandler: RequestHandler) {}

  /**
   * Handle Lambda invocation from Bedrock AgentCore Gateway
   */
  async handle(
    event: Record<string, unknown>,
    context: Context
  ): Promise<unknown> {
    // Extract tool metadata from context
    const clientContext = context.clientContext as unknown as Record<string, unknown> | undefined;
    const custom = clientContext?.["custom"] as Record<string, unknown> | undefined;
    const gatewayToolName = custom?.["bedrockAgentCoreToolName"] as string | undefined;

    if (!gatewayToolName) {
      throw new Error("Missing bedrockAgentCoreToolName in context");
    }

    // Gateway names the tools like <target name>___<tool name>
    const delimiter = "___";
    const delimiterIndex = gatewayToolName.indexOf(delimiter);
    if (delimiterIndex === -1) {
      throw new Error(`Invalid gateway tool name format: ${gatewayToolName}`);
    }
    const toolName = gatewayToolName.substring(
      delimiterIndex + delimiter.length
    );

    if (!toolName) {
      throw new Error(`Invalid gateway tool name format: ${gatewayToolName}`);
    }

    // Create JSON-RPC request from gateway event
    const jsonRpcRequest: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: event,
      },
    };

    const result = await this.requestHandler.handleRequest(
      jsonRpcRequest,
      context
    );

    if (isJSONRPCError(result)) {
      throw new Error(result.error.message);
    }

    return result.result;
  }
}
