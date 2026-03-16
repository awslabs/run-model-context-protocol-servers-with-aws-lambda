import os
import sys

import boto3
from mcp.client.stdio import StdioServerParameters
from mcp_lambda import (
    BedrockAgentCoreGatewayTargetHandler,
    StdioServerAdapterRequestHandler,
)

# Get AWS credentials from Lambda execution role to pass to subprocess
session = boto3.Session()
credentials = session.get_credentials()

server_params = StdioServerParameters(
    command=sys.executable,
    args=["-c", "from awslabs.amazon_sns_sqs_mcp_server.server import main; main()"],
    env={
        "AWS_DEFAULT_REGION": os.environ.get("AWS_REGION", "us-west-2"),
        "AWS_ACCESS_KEY_ID": credentials.access_key,
        "AWS_SECRET_ACCESS_KEY": credentials.secret_key,
        "AWS_SESSION_TOKEN": credentials.token,
    },
)

request_handler = StdioServerAdapterRequestHandler(server_params)
event_handler = BedrockAgentCoreGatewayTargetHandler(request_handler)


def handler(event, context):
    return event_handler.handle(event, context)
