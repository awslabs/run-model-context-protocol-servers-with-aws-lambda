import sys
from mcp.client.stdio import StdioServerParameters
from mcp_lambda import stdio_server_adapter

server_params = StdioServerParameters(
    command=sys.executable,
    args=[
        "-m",
        "awslabs.amazon_sns_sqs_mcp_server.server",
    ],
)


def handler(event, context):
    return stdio_server_adapter(server_params, event, context)
