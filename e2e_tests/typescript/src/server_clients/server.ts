import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  CallToolResult,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";
import { Tool } from "./tool.js";
import logger from "../logger.js";
import {
  ToolResultBlock,
  ToolResultContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
/**
 * Abstract base class for communicating with an MCP server.
 */
export abstract class Server {
  name: string;
  config: Record<string, any>;
  client: Client;

  constructor(name: string, config: Record<string, any>) {
    this.name = name;
    this.config = config;
    this.client = new Client(
      {
        name: "typescript-chatbot",
        version: "0.1.0",
      },
      {
        capabilities: {
          sampling: {},
        },
      }
    );
  }

  /**
   * Async context manager entry
   */
  async initialize(): Promise<void> {
    // To be implemented by subclasses
  }

  /**
   * Async context manager exit
   */
  async close(): Promise<void> {
    await this.client.close();
  }

  /**
   * List available tools from the server.
   * @returns A list of available tools.
   * @throws RuntimeError if the server is not initialized.
   */
  async listTools(): Promise<Tool[]> {
    const toolsResponse = await this.client.listTools();
    const tools: Tool[] = [];

    // TODO manage pagination
    for (const tool of toolsResponse.tools) {
      tools.push(new Tool(tool.name, tool.description || "", tool.inputSchema));
    }

    return tools;
  }

  /**
   * Execute a tool with retry mechanism.
   * @param toolName Name of the tool to execute.
   * @param toolUseId ID assigned by Bedrock Converse API.
   * @param arguments Tool arguments.
   * @param retries Number of retry attempts.
   * @param delay Delay between retries in seconds.
   * @returns Tool execution result.
   * @throws RuntimeError if server is not initialized.
   */
  async executeTool(
    toolName: string,
    toolUseId: string,
    args: Record<string, any>,
    retries: number = 2,
    delay: number = 1.0
  ): Promise<ToolResultBlock> {
    let attempt = 0;
    while (attempt < retries) {
      try {
        logger.info(`Executing ${toolName}...`);
        const result: CallToolResult = (await this.client.callTool({
          name: toolName,
          arguments: args,
        })) as CallToolResult;
        logger.info(`Finished executing ${toolName}`);

        if (result.isError) {
          throw new Error(`Error executing tool: ${JSON.stringify(result)}`);
        }

        if (result.structuredContent) {
          return {
            toolUseId: toolUseId,
            content: [{ text: JSON.stringify(result.structuredContent) }],
            status: "success",
          };
        }

        const content: ToolResultContentBlock[] = [];
        for (const block of result.content) {
          if (block.type === "text") {
            content.push({ text: (block as TextContent).text });
          } else {
            throw new Error(`Unexpected content type: ${block.type}`);
          }
        }

        return {
          toolUseId: toolUseId,
          content,
          status: "success",
        };
      } catch (e) {
        attempt += 1;
        logger.warn(
          `Error executing tool: ${e}. Attempt ${attempt} of ${retries}.`
        );
        if (attempt < retries) {
          logger.info(`Retrying in ${delay} seconds...`);
          await new Promise((resolve) => setTimeout(resolve, delay * 1000));
        } else {
          logger.error("Max retries reached. Failing.");
          return {
            toolUseId: toolUseId,
            content: [{ text: `Error executing tool: ${String(e)}` }],
            status: "error",
          };
        }
      }
    }

    // This should never be reached due to the loop above
    throw new Error("Unexpected error in executeTool");
  }
}
