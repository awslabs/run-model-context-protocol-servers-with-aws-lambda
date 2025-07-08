import { Context } from "aws-lambda";
import {
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCError,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * Interface for handling individual JSON-RPC requests
 * 
 * This interface defines the contract for processing MCP (Model Context Protocol) requests
 * in AWS Lambda functions. Implementations should contain the business logic for handling
 * specific JSON-RPC methods.
 */
export interface RequestHandler {
  /**
   * Process a single JSON-RPC request and return a response or error
   * 
   * @param request The JSON-RPC request to process
   * @param context The AWS Lambda context providing runtime information
   * @returns A Promise that resolves to either a JSON-RPC response (for successful requests) 
   *          or a JSON-RPC error (for failed requests)
   * 
   * @example
   * ```typescript
   * async handleRequest(request: JSONRPCRequest, context: Context): Promise<JSONRPCResponse | JSONRPCError> {
   *   switch (request.method) {
   *     case "ping":
   *       return {
   *         jsonrpc: "2.0",
   *         result: { message: "pong" },
   *         id: request.id,
   *       };
   *     default:
   *       return {
   *         jsonrpc: "2.0",
   *         error: {
   *           code: -32601,
   *           message: "Method not found",
   *         },
   *         id: request.id,
   *       };
   *   }
   * }
   * ```
   */
  handleRequest(
    request: JSONRPCRequest,
    context: Context
  ): Promise<JSONRPCResponse | JSONRPCError>;
}
