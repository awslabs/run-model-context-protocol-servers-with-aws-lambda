import { Context } from 'aws-lambda';
import { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCError,
  isJSONRPCResponse,
  isJSONRPCError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { createLogger, format, transports } from 'winston';
import { RequestHandler } from '../handlers/request_handler.js';
import { stdioServerAdapter } from './stdio_server_adapter.js';

const logger = createLogger({
  level: process.env.LOG_LEVEL?.toLowerCase() || 'info',
  format: format.simple(),
  transports: [new transports.Console()],
});

/**
 * Generic Request Handler for MCP Stdio Server Adapter
 *
 * This class provides a reusable implementation of the RequestHandler interface
 * that delegates JSON-RPC requests to an MCP server via the stdio server adapter.
 * 
 * Usage:
 * ```typescript
 * const serverParams = {
 *   command: "node",
 *   args: ["path/to/mcp-server.js", "--option", "value"]
 * };
 * 
 * const handler = new StdioServerAdapterRequestHandler(serverParams);
 * const streamableHandler = new StreamableHttpHandler(handler);
 * ```
 */
export class StdioServerAdapterRequestHandler implements RequestHandler {
  constructor(private serverParams: StdioServerParameters) {}

  async handleRequest(
    request: JSONRPCRequest,
    context: Context
  ): Promise<JSONRPCResponse | JSONRPCError> {
    try {
      // Call the MCP server adapter with the individual request
      const mcpResponse = await stdioServerAdapter(
        this.serverParams,
        request,
        context
      );

      // The stdioServerAdapter should return JSONRPCResponse or JSONRPCError for requests
      if (isJSONRPCResponse(mcpResponse) || isJSONRPCError(mcpResponse)) {
        return mcpResponse;
      } else {
        // Unexpected response format - return internal server error
        logger.error(
          'Unexpected response format from stdioServerAdapter:',
          mcpResponse
        );
        return {
          jsonrpc: '2.0',
          error: {
            code: ErrorCode.InternalError,
            message:
              'Internal error: Unexpected response format from MCP server',
            data: 'Expected JSONRPCResponse or JSONRPCError',
          },
          id: request.id,
        };
      }
    } catch (error) {
      // Return JSON-RPC error response
      return {
        jsonrpc: '2.0',
        error: {
          code: ErrorCode.InternalError,
          message: 'Internal error',
          data: error instanceof Error ? error.message : 'Unknown error',
        },
        id: request.id,
      };
    }
  }
}
