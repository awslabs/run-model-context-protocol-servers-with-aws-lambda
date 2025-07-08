import sys
from mcp.client.stdio import StdioServerParameters
from mcp_lambda import LambdaFunctionURLEventHandler, StdioServerAdapterRequestHandler

server_params = StdioServerParameters(
    command=sys.executable,
    args=[
        "-m",
        "mcpdoc.cli",
        "--urls",
        "Strands:https://strandsagents.com/latest/llms.txt",
        "--allowed-domains",
        "strandsagents.com",
    ],
)


request_handler = StdioServerAdapterRequestHandler(server_params)
event_handler = LambdaFunctionURLEventHandler(request_handler)


def handler(event, context):
    # To customize the handler based on the caller's identity, you can use properties like:
    # event.requestContext.authorizer.iam

    return event_handler.handle(event, context)
