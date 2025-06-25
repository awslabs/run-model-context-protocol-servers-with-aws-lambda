import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "../streaming/server/streamableHttp";

// Extract context from MCP Server
export function extractContext<T = Record<string, unknown>>(
    server: McpServer
): T | undefined {
    const transport = server.server.transport as StreamableHTTPServerTransport;
    const context = transport.getContext();
    return context as T;
}