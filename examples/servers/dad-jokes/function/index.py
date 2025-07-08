import sys
from mcp.client.stdio import StdioServerParameters
from mcp_lambda import APIGatewayProxyEventHandler, StdioServerAdapterRequestHandler

server_params = StdioServerParameters(
    command=sys.executable,
    args=[
        "-c",
        "from mcp_openapi_proxy import main; main()",
    ],
    env={"OPENAPI_SPEC_URL": "file://dad-jokes-openapi.json"},
)

request_handler = StdioServerAdapterRequestHandler(server_params)
event_handler = APIGatewayProxyEventHandler(request_handler)


def handler(event, context):
    # To customize the handler based on the caller's identity, you can use properties like:
    # event.requestContext.authorizer.claims["cognito:username"]

    return event_handler.handle(event, context)
