import sys
from mcp.client.stdio import StdioServerParameters
from mcp_lambda import stdio_server_adapter

server_params = StdioServerParameters(
    command=sys.executable,
    args=[
        "-m",
        "mcpdoc",
        "--urls", "Strands:https://strandsagents.com/latest/llms.txt",
        "--allowed-domains", "strandsagents.com",
    ],
)


def handler(event, context):
    return stdio_server_adapter(server_params, event, context)
