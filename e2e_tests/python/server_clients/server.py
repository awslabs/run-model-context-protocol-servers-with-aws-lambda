import asyncio
import logging
from typing import Any
from abc import ABC, abstractmethod

from mcp import ClientSession

from server_clients.tool import Tool


class Server(ABC):
    """Abstract base class for communicating with an MCP server."""

    def __init__(self, name: str, config: dict[str, Any]) -> None:
        self.name: str = name
        self.config: dict[str, Any] = config
        self._client = None
        self.session: ClientSession | None = None

    async def __aenter__(self):
        """Async context manager entry"""
        await self.initialize()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit"""
        if self.session:
            await self.session.__aexit__(exc_type, exc_val, exc_tb)
        if self._client:
            await self._client.__aexit__(exc_type, exc_val, exc_tb)

    @abstractmethod
    async def initialize(self) -> None:
        """Initialize the server connection.

        Raises:
            ValueError: If initialization parameters are invalid
            RuntimeError: If server fails to initialize
        """
        pass

    async def list_tools(self) -> list[Any]:
        """List available tools from the server.

        Returns:
            A list of available tools.

        Raises:
            RuntimeError: If the server is not initialized.
        """
        if not self.session:
            raise RuntimeError(f"Server {self.name} not initialized")

        tools_response = await self.session.list_tools()
        tools = []

        for item in tools_response:
            if isinstance(item, tuple) and item[0] == "tools":
                for tool in item[1]:
                    tools.append(Tool(tool.name, tool.description, tool.inputSchema))

        return tools

    async def execute_tool(
        self,
        tool_name: str,
        tool_use_id: str,
        arguments: dict[str, Any],
        retries: int = 2,
        delay: float = 1.0,
    ) -> Any:
        """Execute a tool with retry mechanism.

        Args:
            tool_name: Name of the tool to execute.
            tool_use_id: ID assigned by Bedrock Converse API.
            arguments: Tool arguments.
            retries: Number of retry attempts.
            delay: Delay between retries in seconds.

        Returns:
            Tool execution result.

        Raises:
            RuntimeError: If server is not initialized.
            Exception: If tool execution fails after all retries.
        """
        if not self.session:
            raise RuntimeError(f"Server {self.name} not initialized")

        attempt = 0
        while attempt < retries:
            try:
                logging.info(f"Executing {tool_name}...")
                result = await self.session.call_tool(tool_name, arguments)
                logging.info(f"Finished executing {tool_name}")

                if hasattr(result, "isError") and result.isError:
                    raise Exception(f"Error executing tool: {result}")

                if hasattr(result, "structuredContent") and result.structuredContent:
                    return {
                        "toolUseId": tool_use_id,
                        "content": [{"text": str(result.structuredContent)}],
                        "status": "success",
                    }

                content = []
                if hasattr(result, "content"):
                    for block in result.content:
                        if hasattr(block, "type") and block.type == "text":
                            content.append({"text": block.text})
                        else:
                            raise Exception(
                                f"Unexpected content type: {getattr(block, 'type', 'unknown')}"
                            )
                else:
                    raise Exception(f"No content found in result: {str(result)}")

                return {
                    "toolUseId": tool_use_id,
                    "content": content,
                    "status": "success",
                }

            except Exception as e:
                attempt += 1
                logging.warning(
                    f"Error executing tool: {e}. Attempt {attempt} of {retries}."
                )
                if attempt < retries:
                    logging.info(f"Retrying in {delay} seconds...")
                    await asyncio.sleep(delay)
                else:
                    logging.error("Max retries reached. Failing.")
                    return {
                        "toolUseId": tool_use_id,
                        "content": [{"text": f"Error executing tool: {str(e)}"}],
                        "status": "error",
                    }
