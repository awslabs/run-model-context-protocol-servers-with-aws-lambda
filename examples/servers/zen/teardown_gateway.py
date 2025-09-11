#!/usr/bin/env python3

import json
import os
import boto3
from botocore.config import Config


def main():
    # Get unique suffix for integration tests
    suffix = f'-{os.environ["INTEG_TEST_ID"]}' if "INTEG_TEST_ID" in os.environ else ""

    # Get gateway info from SSM
    ssm_client = boto3.client("ssm", region_name="us-west-2")

    try:
        response = ssm_client.get_parameter(
            Name=f"LambdaMcpServer-Zen-Gateway{suffix}"
        )
        gateway_info = json.loads(response["Parameter"]["Value"])
        gateway_id = gateway_info["gatewayId"]
    except ssm_client.exceptions.ParameterNotFound:
        print("Gateway parameter not found. Nothing to tear down.")
        return

    # Delete all gateway targets
    retry_config = Config(
        retries={
            "max_attempts": 10,
            "mode": "standard",
        }
    )
    agentcore_client = boto3.client(
        "bedrock-agentcore-control", region_name="us-west-2", config=retry_config
    )

    targets = agentcore_client.list_gateway_targets(gatewayIdentifier=gateway_id)
    for target in targets["items"]:
        agentcore_client.delete_gateway_target(
            gatewayIdentifier=gateway_id, targetId=target["targetId"]
        )
        print(f"Deleted target: {target['targetId']}")

    # Delete gateway
    agentcore_client.delete_gateway(gatewayIdentifier=gateway_id)

    # Delete SSM parameter
    ssm_client.delete_parameter(Name=f"LambdaMcpServer-Zen-Gateway{suffix}")

    print(f"Gateway {gateway_id} deleted successfully")


if __name__ == "__main__":
    main()
