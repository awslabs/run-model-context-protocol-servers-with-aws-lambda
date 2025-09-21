"""
Amazon EKS MCP Server Lambda Handler

This Lambda function provides Amazon EKS cluster management capabilities
through the Model Context Protocol (MCP) for Bedrock AgentCore Gateway integration.

Features:
- EKS cluster management and monitoring
- Kubernetes resource operations
- CloudWatch logs and metrics integration
- Bedrock AgentCore Gateway compatibility
"""

import os
import sys
import boto3
from mcp_lambda import (
    BedrockAgentCoreGatewayTargetHandler,
    StdioServerAdapterRequestHandler,
)
from mcp.client.stdio import StdioServerParameters

def handler(event, context):
    """
    Lambda handler for Amazon EKS MCP Server.
    
    Provides EKS cluster management capabilities including cluster operations,
    Kubernetes resource management, and CloudWatch integration.
    
    Args:
        event: Lambda event containing request data
        context: Lambda context with runtime information
        
    Returns:
        Response from the MCP server via Bedrock AgentCore Gateway
    """
    try:
        # Get AWS credentials from Lambda execution role
        session = boto3.Session()
        credentials = session.get_credentials()

        # Server configuration with proper StdioServerParameters
        server_params = StdioServerParameters(
            command=sys.executable,
            args=["-m", "awslabs.eks_mcp_server.server"],
            env={
                "FASTMCP_LOG_LEVEL": "ERROR",
                "AWS_DEFAULT_REGION": os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1")),
                "AWS_ACCESS_KEY_ID": credentials.access_key,
                "AWS_SECRET_ACCESS_KEY": credentials.secret_key,
                "AWS_SESSION_TOKEN": credentials.token,
                # Set cache and temp directories to writable /tmp location
                "CACHE_DIR": "/tmp",
                "TMPDIR": "/tmp"
            }
        )

        # Extract tool name from event if not in context (for local development)
        if not (context.client_context and hasattr(context.client_context, "custom") and
                context.client_context.custom.get("bedrockAgentCoreToolName")):
            tool_name = None
            if isinstance(event, dict):
                tool_name = (event.get("toolName") or
                            event.get("tool_name") or
                            event.get("bedrockAgentCoreToolName"))
                headers = event.get("headers", {})
                if headers:
                    tool_name = tool_name or headers.get("bedrockAgentCoreToolName")

            if tool_name:
                # Construct client context directly for local development
                if not hasattr(context, 'client_context') or not context.client_context:
                    context.client_context = type('ClientContext', (), {})()
                if not hasattr(context.client_context, 'custom'):
                    context.client_context.custom = {}
                context.client_context.custom["bedrockAgentCoreToolName"] = tool_name

        # Create request handler with proper StdioServerParameters
        request_handler = StdioServerAdapterRequestHandler(server_params)

        # Create Bedrock AgentCore Gateway handler
        gateway_handler = BedrockAgentCoreGatewayTargetHandler(request_handler)

        result = gateway_handler.handle(event, context)
        
        return result
        
    except Exception as e:
        print(f"Error in eks-mcp Lambda handler: {str(e)}")
        raise
