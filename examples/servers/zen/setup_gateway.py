#!/usr/bin/env python3

import json
import os
import boto3
from botocore.config import Config
from bedrock_agentcore_starter_toolkit.operations.gateway.client import GatewayClient


def main():
    # Get unique suffix for integration tests
    suffix = f'-{os.environ["INTEG_TEST_ID"]}' if "INTEG_TEST_ID" in os.environ else ""

    # Get account ID
    sts = boto3.client("sts")
    account_id = sts.get_caller_identity()["Account"]

    # Load OpenAPI schema
    with open("zenquotes-openapi.json", "r") as f:
        openapi_schema = json.load(f)

    # Get Cognito authorizer info from CloudFormation stack
    cf_client = boto3.client("cloudformation", region_name="us-west-2")
    stack_response = cf_client.describe_stacks(StackName="LambdaMcpServer-Auth")

    outputs = {
        output["OutputKey"]: output["OutputValue"]
        for output in stack_response["Stacks"][0]["Outputs"]
    }

    authorizer_config = {
        "customJWTAuthorizer": {
            "allowedClients": [
                outputs["InteractiveOAuthClientId"],
                outputs["AutomatedOAuthClientId"],
            ],
            "discoveryUrl": f"{outputs['IssuerDomain']}/.well-known/openid-configuration",
        }
    }

    # Create Gateway client for us-west-2
    gateway_client = GatewayClient(region_name="us-west-2")
    retry_config = Config(
        retries={
            "max_attempts": 10,
            "mode": "standard",
        }
    )
    boto_client = boto3.client(
        "bedrock-agentcore-control", region_name="us-west-2", config=retry_config
    )
    gateway_client.client = boto_client

    # Create Gateway
    role_arn = f"arn:aws:iam::{account_id}:role/mcp-lambda-example-agentcore-gateways"

    gateway_name = f"LambdaMcpServer-Zen-Gateway{suffix}"
    if len(gateway_name) > 50:
        gateway_name = gateway_name[:50].rstrip('-')

    gateway = gateway_client.create_mcp_gateway(
        name=gateway_name,
        role_arn=role_arn,
        authorizer_config=authorizer_config,
        enable_semantic_search=False,
    )

    # Save Gateway URL and ID to SSM
    ssm_client = boto3.client("ssm", region_name="us-west-2")

    gateway_info = {
        "gatewayId": gateway["gatewayId"],
        "url": gateway["gatewayUrl"],
    }

    ssm_client.put_parameter(
        Name=f"LambdaMcpServer-Zen-Gateway{suffix}",
        Value=json.dumps(gateway_info),
        Type="String",
        Overwrite=True,
    )

    # Create OpenAPI target
    gateway_client.create_mcp_gateway_target(
        gateway=gateway,
        name="zenquotes-target",
        target_type="openApiSchema",
        target_payload={"inlinePayload": json.dumps(openapi_schema)},
        # Target API does not require authentication, but Gateway requires credentials be provided.
        # Provide fake creds to a custom header
        credentials={
            "api_key": "hello world",
            "credential_location": "HEADER",
            "credential_parameter_name": "X-Ignore-This",
        },
    )

    print(f"Gateway created successfully:")
    print(f"  ID: {gateway['gatewayId']}")
    print(f"  URL: {gateway['gatewayUrl']}")
    print(f"  Saved to SSM parameter: LambdaMcpServer-Zen-Gateway{suffix}")


if __name__ == "__main__":
    main()
