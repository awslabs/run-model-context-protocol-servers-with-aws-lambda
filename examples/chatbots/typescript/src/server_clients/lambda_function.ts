import {
  LambdaFunctionParameters,
  LambdaFunctionClientTransport,
} from "mcp-server-in-aws-lambda";
import { Server } from "./server.js";
import logger from "../logger.js";

/**
 * Manages MCP server connections and tool execution for servers running in Lambda functions.
 */
export class LambdaFunctionClient extends Server {
  /**
   * Initialize the server connection.
   * @throws ValueError if initialization parameters are invalid
   * @throws RuntimeError if server fails to initialize
   */
  async initialize(): Promise<void> {
    if (!this.config.functionName) {
      throw new Error(
        "The functionName must be a valid string and cannot be None."
      );
    }

    const serverParams: LambdaFunctionParameters = {
      functionName: this.config.functionName,
      regionName: this.config.region,
    };

    const transport = new LambdaFunctionClientTransport(serverParams);

    try {
      await this.client.connect(transport);
    } catch (e) {
      logger.error(`Error initializing server ${this.name}: ${e}`);
      throw e;
    }
  }
}
