import asyncio
import json
import logging
from typing import Optional

from server_clients.server import Server
from server_clients.servers import Servers
from llm_client import LLMClient


class ChatSession:
    """Orchestrates the interaction between user, LLM, and tools."""

    def __init__(
        self, servers: list[Server], llm_client: LLMClient, user_utterances: list[str]
    ) -> None:
        self.servers: list[Server] = servers
        self.llm_client: LLMClient = llm_client
        self.user_utterances: list[str] = user_utterances

    async def execute_requested_tools(
        self, servers_manager: Servers, llm_response
    ) -> Optional[list[dict]]:
        """Process the LLM response and execute tools if needed.

        Args:
            llm_response: The response from the Bedrock Converse API.

        Returns:
            The result of tool execution, if any.
        """
        stop_reason = llm_response["stopReason"]

        if stop_reason == "tool_use":
            try:
                tool_responses = []
                for content_item in llm_response["output"]["message"]["content"]:
                    if "toolUse" in content_item:
                        logging.info(
                            f'Executing tool: {content_item["toolUse"]["name"]}'
                        )
                        logging.info(
                            f'With arguments: {content_item["toolUse"]["input"]}'
                        )
                        response = await servers_manager.execute_tool(
                            content_item["toolUse"]["name"],
                            content_item["toolUse"]["toolUseId"],
                            content_item["toolUse"]["input"],
                        )
                        tool_responses.append(response)
                return {"role": "user", "content": tool_responses}
            except KeyError as e:
                raise ValueError(f"Missing required tool use field: {e}")
            except Exception as e:
                raise ValueError(f"Failed to execute tool: {e}")
        else:
            # Assume this catches stop reasons "end_turn", "stop_sequence", and "max_tokens"
            return None

    async def start(self) -> None:
        """Main chat session handler."""
        async with Servers(self.servers) as server_manager:
            all_tools = await server_manager.list_tools()
            tools_description = [tool.format_for_llm() for tool in all_tools]

            system_prompt = "You are a helpful assistant."

            messages = []

            for i, user_input in enumerate(self.user_utterances):
                # To reduce token use, clear out past messages for each utterance
                messages = []

                print(f"\nYou: {user_input}")

                messages.append({"role": "user", "content": [{"text": user_input}]})

                llm_response = None
                while llm_response is None or llm_response["stopReason"] == "tool_use":
                    # Get the next response
                    llm_response = self.llm_client.get_response(
                        messages, system_prompt, tools_description
                    )
                    messages.append(llm_response["output"]["message"])
                    logging.debug("\nAssistant: %s", json.dumps(llm_response, indent=2))
                    if "text" in llm_response["output"]["message"]["content"][0]:
                        print(
                            f'\nAssistant: {llm_response["output"]["message"]["content"][0]["text"]}'
                        )

                    # Execute tools if requested
                    tool_results = await self.execute_requested_tools(
                        server_manager, llm_response
                    )
                    if tool_results:
                        logging.debug(
                            "\nTool Results: %s", json.dumps(tool_results, indent=2)
                        )
                        messages.append(tool_results)
