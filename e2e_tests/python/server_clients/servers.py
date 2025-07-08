import logging

from server_clients.server import Server
from server_clients.tool import Tool
from typing import Any


class Servers:
    """Class for managing multiple MCP servers."""

    def __init__(self, servers: list[Server]) -> None:
        self.servers: list[Server] = servers

    async def __aenter__(self):
        """Async context manager entry"""
        logging.info("Starting servers")
        initialized_servers = []
        for server in self.servers:
            logging.info(f"Starting server: {server.name}")
            server = await server.__aenter__()
            initialized_servers.append(server)
        self.servers = initialized_servers
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        logging.info("Stopping servers")
        for server in reversed(self.servers):
            logging.info(f"Stopping server: {server.name}")
            await server.__aexit__(exc_type, exc_val, exc_tb)

    async def list_tools(self) -> list[Tool]:
        """List all tools from all servers"""
        tools = []
        for server in self.servers:
            tools.extend(await server.list_tools())
        return tools

    async def find_server_with_tool(self, tool_name: str) -> Server:
        """Find the server that has the given tool"""
        for server in self.servers:
            tools = await server.list_tools()
            if any(tool.name == tool_name for tool in tools):
                return server
        raise ValueError(f"Tool {tool_name} not found in any server")

    async def execute_tool(
        self, tool_name: str, tool_use_id: str, arguments: str
    ) -> Any:
        """Execute the given tool on the appropriate server"""
        try:
            server = await self.find_server_with_tool(tool_name)

            result = await server.execute_tool(
                tool_name=tool_name,
                tool_use_id=tool_use_id,
                arguments=arguments,
            )

            return {"toolResult": result}
        except ValueError:
            return {
                "toolResult": {
                    "toolUseId": tool_use_id,
                    "content": [{"text": f"No server found with tool: {tool_name}"}],
                    "status": "error",
                }
            }
