import asyncio
import boto3
from botocore.config import Config
import json
import logging
import os
from typing import Any

from chat_session import ChatSession
from llm_client import LLMClient
from server_clients.stdio_server import StdioServer
from server_clients.lambda_function import LambdaFunctionClient
from server_clients.lambda_function_url import (
    LambdaFunctionUrlClient,
    LambdaFunctionUrlConfig,
)
from server_clients.automated_oauth import (
    AutomatedOAuthClient,
    AutomatedOAuthConfig,
)

# Configure logging
logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper()),
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logging.getLogger("aiobotocore").setLevel(logging.CRITICAL)
logging.getLogger("boto3").setLevel(logging.CRITICAL)
logging.getLogger("botocore").setLevel(logging.CRITICAL)
logging.getLogger("urllib3").setLevel(logging.CRITICAL)


class Configuration:
    """Manages configuration for the MCP client and the Bedrock client."""

    def __init__(
        self,
        model_id="us.anthropic.claude-3-7-sonnet-20250219-v1:0",
        region="us-west-2",
    ) -> None:
        """Initialize configuration."""
        self.model_id = model_id
        self.region = region

    @staticmethod
    def load_config(file_path: str) -> dict[str, Any]:
        """Load server configuration from JSON file.

        Args:
            file_path: Path to the JSON configuration file.

        Returns:
            Dict containing server configuration.

        Raises:
            FileNotFoundError: If configuration file doesn't exist.
            JSONDecodeError: If configuration file is invalid JSON.
        """
        with open(file_path, "r") as f:
            return json.load(f)

    @property
    def bedrock_client(self) -> Any:
        """Get a Bedrock runtime client.

        Returns:
            The Bedrock client.
        """
        retry_config = Config(
            retries={
                "max_attempts": 10,
                "mode": "standard",
            }
        )
        return boto3.client(
            "bedrock-runtime", region_name=self.region, config=retry_config
        )


async def main() -> None:
    """Initialize and run the chat session."""
    config = Configuration()
    server_config = config.load_config("servers_config.json")
    servers = [
        StdioServer(name, srv_config)
        for name, srv_config in server_config["stdioServers"].items()
    ]
    servers.extend(
        [
            LambdaFunctionClient(name, srv_config)
            for name, srv_config in server_config["lambdaFunctionServers"].items()
        ]
    )

    # Add Lambda function URL servers if they exist in config
    if "lambdaFunctionUrlServers" in server_config:
        servers.extend(
            [
                LambdaFunctionUrlClient(name, LambdaFunctionUrlConfig(**srv_config))
                for name, srv_config in server_config[
                    "lambdaFunctionUrlServers"
                ].items()
            ]
        )

    # Add automated OAuth servers if they exist in config
    if "oAuthServers" in server_config:
        servers.extend(
            [
                AutomatedOAuthClient(name, AutomatedOAuthConfig(**srv_config))
                for name, srv_config in server_config["oAuthServers"].items()
            ]
        )
    llm_client = LLMClient(config.bedrock_client, config.model_id)
    user_utterances = config.load_config("../test_questions.json")
    chat_session = ChatSession(servers, llm_client, user_utterances)
    await chat_session.start()


if __name__ == "__main__":
    asyncio.run(main())
