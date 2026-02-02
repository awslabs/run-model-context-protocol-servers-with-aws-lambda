import json
import logging
import os
import sys
from typing import Any

from botocore.config import Config
from strands import Agent
from strands.models import BedrockModel
from strands.agent.conversation_manager import NullConversationManager
from strands_evals import Case, Experiment
from strands_evals.extractors import tools_use_extractor
from strands_evals.types import TaskOutput
from mcp_clients import (
    create_stdio_client,
    create_lambda_function_client,
    create_lambda_function_url_client,
    create_automated_oauth_client,
)
from tool_call_evaluator import ToolCallEvaluator

# Configure logging
logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper()),
    format="%(asctime)s - %(levelname)s - %(message)s",
)

# Suppress boto3 credential info messages
logging.getLogger("boto3").setLevel(logging.WARNING)
logging.getLogger("botocore").setLevel(logging.WARNING)
logging.getLogger("strands").setLevel(logging.WARNING)


def load_config(file_path: str) -> dict[str, Any]:
    """Load server configuration from JSON file."""
    with open(file_path, "r") as f:
        return json.load(f)


def main() -> None:
    """Initialize and run the chat session with evaluation."""
    server_config = load_config("servers_config.json")
    user_utterances = load_config("../test_questions.json")

    # Create MCP clients for all server types
    mcp_clients = []

    # Add stdio servers
    for name, srv_config in server_config.get("stdioServers", {}).items():
        client = create_stdio_client(name, srv_config)
        mcp_clients.append((name, client))
        logging.info(f"Added stdio server: {name}")

    # Add lambda function servers
    for name, srv_config in server_config.get("lambdaFunctionServers", {}).items():
        client = create_lambda_function_client(name, srv_config)
        mcp_clients.append((name, client))
        logging.info(f"Added lambda function server: {name}")

    # Add lambda function URL servers
    for name, srv_config in server_config.get("lambdaFunctionUrls", {}).items():
        client = create_lambda_function_url_client(name, srv_config)
        mcp_clients.append((name, client))
        logging.info(f"Added lambda function URL server: {name}")

    # Add OAuth servers
    for name, srv_config in server_config.get("oAuthServers", {}).items():
        client = create_automated_oauth_client(name, srv_config)
        mcp_clients.append((name, client))
        logging.info(f"Added OAuth server: {name}")

    if not mcp_clients:
        raise RuntimeError(
            "No MCP clients were successfully created. Cannot start chatbot without tools."
        )

    # Create Bedrock model
    retry_config = Config(
        retries={
            "max_attempts": 10,
            "mode": "standard",
        }
    )
    bedrock_model = BedrockModel(
        model_id="global.anthropic.claude-haiku-4-5-20251001-v1:0",
        region_name="us-west-2",
        streaming=False,
        boto_client_config=retry_config,
    )

    # Create agent with MCP tools
    agent = Agent(
        model=bedrock_model,
        tools=[client for _, client in mcp_clients],
        system_prompt="You are a helpful assistant. Always retry tool call failures to recover from issues like transient network errors.",
        conversation_manager=NullConversationManager(),
    )

    # List tools from each MCP client
    for name, client in mcp_clients:
        tools = client.list_tools_sync()
        logging.info(f"Tools from {name}: {[t.tool_name for t in tools]}")

    # Run all test questions
    for user_input in user_utterances:
        print(f"\nYou: {user_input}")
        print(f"\nAssistant: ")
        agent(user_input)

    # Extract trajectory after all questions
    trajectory = tools_use_extractor.extract_agent_tools_used_from_messages(
        agent.messages
    )

    # Log all tool calls for debugging
    logging.info(f"Total tool calls in trajectory: {len(trajectory)}")
    for i, event in enumerate(trajectory):
        logging.debug(f"Tool call {i+1}: {event['name']}, is_error={event.get('is_error', False)}")

    called_tools = list(set([t["name"] for t in trajectory]))

    # Log tool errors for debugging
    tool_errors = [t for t in trajectory if t.get("is_error", False)]
    if tool_errors:
        logging.error(f"Tool errors detected: {len(tool_errors)}")
        for error in tool_errors:
            logging.error(f"  Tool: {error['name']}, Error: {error.get('tool_result', 'No error message')}")
            logging.debug(f"  Full error event: {error}")

    expected_tools = [
        "get_current_time",  # time server
        "alerts-active-count",  # weather alerts server
        "list_doc_sources",  # mcpdoc server
        "get_root",  # dad jokes server
        "search-dog-breeds",  # dog facts server
        "get-random-cat-fact",  # cat facts server
        "book-search-target___get_search_json",  # book search server
        "dictionary-target___get-word-definition",  # dictionary server
        "zenquotes-target___getTodayQuote",  # zen server
        "fetch",  # fetch server
    ]

    # Create test case for evaluation
    test_cases = [
        Case[str, str](
            name="all_questions",
            input="All test questions",
            metadata={"expected_tools": expected_tools},
        ),
    ]

    # Create evaluator
    evaluator = ToolCallEvaluator(expected_tools=expected_tools)

    # Run evaluation
    def task_fn(case: Case) -> TaskOutput:
        return TaskOutput(output="Completed all questions", trajectory=trajectory)

    experiment = Experiment[str, str](cases=test_cases, evaluators=[evaluator])
    reports = experiment.run_evaluations(task_fn)

    # Print results
    report = reports[0]
    print(f"\n\nEvaluation Results:")
    print(f"Overall Score: {report.overall_score}")
    print(f"Test Passes: {report.test_passes}")
    print(f"Reasons: {report.reasons}")
    print(f"Tools called: {called_tools}")

    # Cleanup agent to avoid event loop errors
    try:
        agent.cleanup()
    except Exception as e:
        logging.warning(f"Error during agent cleanup: {e}")

    # Exit with non-zero code if test fails
    if not report.test_passes:
        sys.exit(1)


if __name__ == "__main__":
    main()
