import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@aws/mcp-streamable-http-transport";
import { JSONRPCNotification } from "@modelcontextprotocol/sdk/types.js";

// MCP Streaming Client - Demonstrates real-time streaming communication with MCP servers

interface MCPClientConfig {
  serverName: string;
  serverVersion: string;
  endpoint: string;
  region?: string;
  service?: string;
}

interface StreamingToolResult {
  success: boolean;
  content?: any;
  error?: string;
  notificationCount?: number;
}

class MCPStreamingClient {
  private client: Client;
  private transport: StreamableHTTPClientTransport | null = null;
  private config: MCPClientConfig;
  private notificationCount = 0;

  constructor(config: MCPClientConfig) {
    this.config = config;
    this.client = new Client({
      name: config.serverName,
      version: config.serverVersion
    });
  }

  // Initialize connection to MCP streaming server
  async connect(): Promise<void> {
    try {
      this.transport = new StreamableHTTPClientTransport(
        new URL(this.config.endpoint),
        {},
        this.config.region || "us-west-2",
        this.config.service || "lambda"
      );

      this.transport.onnotification = (notification: JSONRPCNotification) => {
        this.handleNotification(notification);
      };

      this.transport.onerror = (error: Error) => {
        console.error("Transport error:", error.message);
      };

      this.transport.onclose = () => {
        console.log("Transport connection closed");
      };

      await this.client.connect(this.transport);
      console.log("Connected to MCP streaming server");

    } catch (connectionError) {
      console.error("Failed to connect to MCP streaming server:", connectionError);
      throw new Error(`MCP connection failed: ${connectionError}`);
    }
  }

  // Handle incoming streaming notifications
  private handleNotification(notification: JSONRPCNotification): void {
    this.notificationCount++;

    if (notification.method === 'notifications/message' && notification.params) {
      const notificationData = (notification.params as any).data;
      const notificationLevel = (notification.params as any).level || 'info';
      
      console.log(`📢 [${notificationLevel.toUpperCase()}] ${notificationData}`);
    }
  }

  // Execute a regular (non-streaming) tool
  async executeTool(toolName: string, toolArguments: Record<string, any>): Promise<StreamingToolResult> {
    if (!this.transport) {
      throw new Error("Client not connected. Call connect() first.");
    }

    try {
      const toolResult = await this.client.callTool({
        name: toolName,
        arguments: toolArguments
      });

      return {
        success: true,
        content: toolResult.content,
        notificationCount: 0
      };

    } catch (toolError) {
      console.error("Tool execution failed:", toolError);

      return {
        success: false,
        error: `Tool execution failed: ${toolError}`,
        notificationCount: 0
      };
    }
  }

  // Execute a streaming tool with real-time notifications
  async executeStreamingTool(toolName: string, toolArguments: Record<string, any>): Promise<StreamingToolResult> {
    if (!this.transport) {
      throw new Error("Client not connected. Call connect() first.");
    }

    this.notificationCount = 0;

    try {
      const toolResult = await this.client.callTool({
        name: toolName,
        arguments: toolArguments
      });

      return {
        success: true,
        content: toolResult.content,
        notificationCount: this.notificationCount
      };

    } catch (toolError) {
      console.error("Streaming tool execution failed:", toolError);

      return {
        success: false,
        error: `Tool execution failed: ${toolError}`,
        notificationCount: this.notificationCount
      };
    }
  }

  // Disconnect from the MCP server
  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
    
    console.log("Disconnected from MCP streaming server");
  }
}

// Example usage demonstrating both non-streaming and streaming functionality
async function demonstrateStreamingClient(): Promise<void> {
  const clientConfig: MCPClientConfig = {
    serverName: 'amazon-stateless-streamable-http-server',
    serverVersion: '1.0.0',
    endpoint: 'http://localhost:8080/mcp',
    region: 'us-west-2',
    service: 'lambda'
  };

  const streamingClient = new MCPStreamingClient(clientConfig);

  try {
    await streamingClient.connect();

    console.log("\n🧮 === DEMONSTRATING NON-STREAMING TOOL (Calculator) ===");
    
    const calculatorResult = await streamingClient.executeTool('calculate', {
      operation: 'multiply',
      operandA: 15,
      operandB: 7
    });

    if (calculatorResult.success && calculatorResult.content) {
      const resultText = (calculatorResult.content as any)[0]?.text || 'No result text';
      console.log(`✅ Calculator: ${resultText}`);
    } else {
      console.error("Calculator execution failed:", calculatorResult.error);
    }

    console.log("\n📡 === DEMONSTRATING STREAMING TOOL (Counter with Notifications) ===");

    const streamingResult = await streamingClient.executeStreamingTool('count-with-notifications', {
      maxCount: 5
    });

    if (streamingResult.success && streamingResult.content) {
      const resultText = (streamingResult.content as any)[0]?.text || 'No result text';
      console.log(`✅ Streaming: ${resultText} (${streamingResult.notificationCount} notifications received)`);
    } else {
      console.error("Streaming execution failed:", streamingResult.error);
    }

    console.log("\n🎉 === DEMONSTRATION COMPLETE ===");
    console.log("Both non-streaming and streaming tools executed successfully!");

  } catch (demonstrationError) {
    console.error("Demonstration failed:", demonstrationError);
  } finally {
    await streamingClient.disconnect();
  }
}

// Execute demonstration if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateStreamingClient().catch((error) => {
    console.error("Demonstration execution failed:", error);
    process.exit(1);
  });
}

export { MCPStreamingClient, type MCPClientConfig, type StreamingToolResult };