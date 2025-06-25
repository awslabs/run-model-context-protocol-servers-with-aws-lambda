import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { extractContext } from "./extract-context";

// Extract context field from MCP Server by field key
export function extractContextFiled<T>(
    server: McpServer,
    key: string
): T | undefined {
    const context = extractContext(server);
    if (!context) {
        return undefined;
    }
    return context[key] as T;
}