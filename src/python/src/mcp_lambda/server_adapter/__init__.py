"""
MCP Server Adapter

This package provides adapters for integrating existing MCP servers with AWS Lambda functions.
It includes:

- stdio_server_adapter: Function for delegating requests to MCP stdio servers
- StdioServerAdapterRequestHandler: RequestHandler implementation for stdio servers
"""

from .adapter import stdio_server_adapter
from .stdio_server_adapter_request_handler import StdioServerAdapterRequestHandler

__all__ = [
    "stdio_server_adapter",
    "StdioServerAdapterRequestHandler",
]
