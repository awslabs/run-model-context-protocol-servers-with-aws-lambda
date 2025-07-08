import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SigV4StreamableHTTPServerTransport } from "../streaming/server/streamableHttp";

/**
 * Extracts context from an MCP Server that uses SigV4StreamableHTTPServerTransport.
 *
 * This function is needed to retrieve critical values passed from the client via the x-context header.
 * The client can pass important metadata like user information, session data, environment details, etc.
 * that the server needs to access. This prevents the LLM from hallucinating these critical values and
 * ensures the server has access to accurate, client-provided context for making informed decisions
 * and API calls.
 *
 * @param server - The MCP server instance using SigV4StreamableHTTPServerTransport
 * @returns The extracted context object containing client-provided metadata, or undefined if no context is available
 */
export function extractContext<T = Record<string, unknown>>(
    server: McpServer
): T | undefined {
    const transport = server.server.transport as SigV4StreamableHTTPServerTransport;
    const context = transport.getContext();
    return context as T;
}