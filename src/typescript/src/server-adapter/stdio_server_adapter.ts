import { Context } from "aws-lambda";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  JSONRPCError,
  JSONRPCMessage,
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
  McpError,
  ResultSchema,
  ErrorCode,
  isJSONRPCRequest,
  isJSONRPCNotification,
} from "@modelcontextprotocol/sdk/types.js";
import { createLogger, format, transports } from "winston";

const logger = createLogger({
  level: process.env.LOG_LEVEL?.toLowerCase() || "info",
  format: format.simple(),
  transports: [new transports.Console()],
});

/**
 * Lambda function adapter for MCP stdio-based server
 *
 * This function provides a bridge between a JSON-RPC message in a Lambda function payload
 * and an MCP stdio server. It runs the MCP server as a child process of the function invocation,
 * proxies the message to the MCP server, and returns the server's response.
 * The MCP server is started and shut down on each function invocation.
 *
 * @param serverParams - Configuration for the stdio server (command, args, etc.)
 * @param event - The JSON-RPC message to process
 * @param context - AWS Lambda context
 * @returns Promise resolving to a JSON-RPC response, error, or empty object for notifications
 */
export async function stdioServerAdapter(
  serverParams: StdioServerParameters,
  event: JSONRPCMessage,
  context: Context
) {
  logger.debug(`Request: ${JSON.stringify(event)}`);
  const response = await handleMessage(serverParams, event, context);
  logger.debug(`Response: ${JSON.stringify(response)}`);
  return response;
}

/**
 * Handles incoming JSON-RPC messages by determining their type and routing appropriately
 */
async function handleMessage(
  serverParams: StdioServerParameters,
  event: JSONRPCMessage,
  context: Context
) {
  // Determine the type of the message
  if (isJSONRPCRequest(event)) {
    return await handleRequest(serverParams, event, context);
  } else if (isJSONRPCNotification(event)) {
    return await handleNotification(serverParams, event, context);
  } else {
    // Invalid message format
    return {
      jsonrpc: event.jsonrpc,
      id: 0,
      error: {
        code: ErrorCode.InvalidRequest,
        message:
          "Request is neither a valid JSON-RPC request nor a valid JSON-RPC notification",
      },
    } as JSONRPCError;
  }
}

/**
 * Handles JSON-RPC notifications (fire-and-forget messages)
 */
async function handleNotification(
  _serverParams: StdioServerParameters,
  _event: JSONRPCNotification,
  _context: Context
) {
  // Ignore notifications
  logger.debug("Ignoring notification");
  return {};
}

/**
 * Handles JSON-RPC requests by starting the MCP server and forwarding the request.
 */
async function handleRequest(
  serverParams: StdioServerParameters,
  event: JSONRPCRequest,
  _context: Context
): Promise<JSONRPCMessage> {
  logger.debug("Handling request");
  const { jsonrpc, id, ...request } = event;

  const client = new Client(
    {
      name: "mcp-client",
      version: "1.0.0",
    },
    {
      capabilities: {
        prompts: {},
        resources: {},
        tools: {},
      },
    }
  );

  try {
    const transport = new StdioClientTransport(serverParams);

    await client.connect(transport);

    const result = await client.request(request, ResultSchema);

    return {
      jsonrpc: jsonrpc,
      id: id,
      result: result,
    } as JSONRPCResponse;
  } catch (error) {
    if (error instanceof McpError) {
      logger.error(`MCP error: ${error}`);
      return {
        jsonrpc: jsonrpc,
        id: id,
        error: {
          code: error.code,
          message: error.message,
        },
      } as JSONRPCError;
    } else {
      logger.error(`General exception: ${error}`);
      return {
        jsonrpc: jsonrpc,
        id: id,
        error: {
          code: 500,
          message: "Internal failure, please check Lambda function logs",
        },
      } as JSONRPCError;
    }
  } finally {
    try {
      await client.close();
    } catch (error) {
      logger.error(`Did not cleanly close client ${error}`);
    }
  }
}
