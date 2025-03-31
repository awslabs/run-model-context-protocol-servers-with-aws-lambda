import { Server } from "./server_clients/server.js";
import { Servers } from "./server_clients/servers.js";
import { LLMClient } from "./llm_client.js";
import logger from "./logger.js";
import {
  ContentBlock,
  ConverseCommandOutput,
  Message,
} from "@aws-sdk/client-bedrock-runtime";

/**
 * Orchestrates the interaction between user, LLM, and tools.
 */
export class ChatSession {
  private servers: Server[];
  private llmClient: LLMClient;
  private userUtterances: string[] = [];

  constructor(
    servers: Server[],
    llmClient: LLMClient,
    userUtterances: string[]
  ) {
    this.servers = servers;
    this.llmClient = llmClient;
    this.userUtterances = userUtterances;
  }

  /**
   * Process the LLM response and execute tools if needed.
   * @param serversManager The servers manager.
   * @param llmResponse The response from the Bedrock Converse API.
   * @returns The result of tool execution, if any.
   */
  async executeRequestedTools(
    serversManager: Servers,
    llmResponse: ConverseCommandOutput
  ): Promise<Message | null> {
    const stopReason = llmResponse.stopReason;

    if (stopReason === "tool_use") {
      try {
        const toolResponses: ContentBlock[] = [];
        for (const contentItem of llmResponse.output!.message!.content!) {
          if ("toolUse" in contentItem) {
            logger.info(`Executing tool: ${contentItem.toolUse!.name}`);
            logger.info(
              `With arguments: ${JSON.stringify(contentItem.toolUse!.input)}`
            );
            const response = await serversManager.executeTool(
              contentItem.toolUse!.name!,
              contentItem.toolUse!.toolUseId!,
              contentItem.toolUse!.input! as Record<string, any>
            );
            toolResponses.push(response);
          }
        }
        return { role: "user", content: toolResponses };
      } catch (e) {
        throw new Error(`Failed to execute tool: ${e}`);
      }
    } else {
      // Assume this catches stop reasons "end_turn", "stop_sequence", and "max_tokens"
      return null;
    }
  }

  /**
   * Main chat session handler.
   */
  async start(): Promise<void> {
    const serverManager = new Servers(this.servers);

    try {
      await serverManager.initialize();

      const allTools = await serverManager.listTools();
      const toolsDescription = allTools.map((tool) => tool.formatForLLM());

      const systemPrompt = "You are a helpful assistant.";

      const messages: Message[] = [];

      for (const [i, userInput] of this.userUtterances.entries()) {
        if (i != 0) {
          console.log("\n**Pausing 30 seconds to avoid Bedrock throttling**");
          await new Promise((resolve) => setTimeout(resolve, 30 * 1000));
        }

        console.log(`\You: ${userInput}`);

        messages.push({ role: "user", content: [{ text: userInput }] });

        const llmResponse = await this.llmClient.getResponse(
          messages,
          systemPrompt,
          toolsDescription
        );

        logger.debug("\nAssistant: " + JSON.stringify(llmResponse, null, 2));
        console.log(
          `\nAssistant: ${llmResponse.output!.message!.content![0].text}`
        );
        messages.push(llmResponse.output!.message!);

        const toolResults = await this.executeRequestedTools(
          serverManager,
          llmResponse
        );

        if (toolResults) {
          logger.debug(
            "\nTool Results: " + JSON.stringify(toolResults, null, 2)
          );
          messages.push(toolResults);
          const finalResponse = await this.llmClient.getResponse(
            messages,
            systemPrompt,
            toolsDescription
          );
          logger.debug(
            "\nFinal response: " + JSON.stringify(finalResponse, null, 2)
          );
          console.log(
            `\nAssistant: ${finalResponse.output!.message!.content![0].text}`
          );
          messages.push(finalResponse.output!.message!);
        }
      }
    } finally {
      await serverManager.close();
    }
  }
}
