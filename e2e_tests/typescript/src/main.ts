import { Configuration } from "./configuration.js";
import { ChatSession } from "./chat_session.js";
import { LLMClient } from "./llm_client.js";
import { StdioServer } from "./server_clients/stdio_server.js";
import { LambdaFunctionClient } from "./server_clients/lambda_function.js";
import { Server } from "./server_clients/server.js";
import logger from "./logger.js";

/**
 * Initialize and run the chat session.
 */
async function main(): Promise<void> {
  const config = new Configuration();
  const serverConfig = Configuration.loadConfig("./servers_config.json");

  const servers: Server[] = [];

  // Initialize stdio servers
  for (const [name, srvConfig] of Object.entries(serverConfig.stdioServers)) {
    servers.push(new StdioServer(name, srvConfig as Record<string, any>));
  }

  // Initialize Lambda function servers
  for (const [name, srvConfig] of Object.entries(
    serverConfig.lambdaFunctionServers
  )) {
    servers.push(
      new LambdaFunctionClient(name, srvConfig as Record<string, any>)
    );
  }

  const userUtterances = [
    "Hello!",
    "What is the current time in Seattle?",
    "Are there any weather alerts right now?",
    "Who is Tom Cruise?",
  ];

  const llmClient = new LLMClient(config.bedrockClient, config.modelId);
  const chatSession = new ChatSession(servers, llmClient, userUtterances);

  await chatSession.start();
}

// Handle errors
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Run the main function
main().catch((error) => {
  logger.error("Error in main:", error);
  process.exit(1);
});
