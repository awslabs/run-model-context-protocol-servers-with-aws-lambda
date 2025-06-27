import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMCPTools } from './mcp-tools.js';

// MCP Server Factory - Creates and configures MCP server instances

interface MCPServerConfig {
  serverName: string;
  serverVersion: string;
  enableLogging?: boolean;
}

const defaultServerConfig: MCPServerConfig = {
  serverName: 'amazon-mcp-streaming-server',
  serverVersion: '1.0.0',
  enableLogging: true,
};

// Creates a new MCP server instance with all tools registered
export function createMCPServer(config: Partial<MCPServerConfig> = {}): McpServer {
  const serverConfig = { ...defaultServerConfig, ...config };

  const mcpServer = new McpServer(
    {
      name: serverConfig.serverName,
      version: serverConfig.serverVersion,
    },
    {
      capabilities: {
        logging: serverConfig.enableLogging ? {} : undefined
      }
    }
  );

  registerMCPTools(mcpServer);

  return mcpServer;
}

// Legacy function name for backward compatibility
// @deprecated Use createMCPServer instead
export function getMCPServer(): McpServer {
  console.warn('getMCPServer is deprecated, use createMCPServer instead');
  return createMCPServer();
}

export type { MCPServerConfig };