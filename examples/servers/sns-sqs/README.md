# SNS/SQS MCP Server

This example wraps the [Amazon SNS/SQS MCP Server](https://github.com/awslabs/mcp/tree/main/src/amazon-sns-sqs-mcp-server)
in a Lambda function.

- Language: Python
- Transport: Bedrock AgentCore Gateway
- Authentication: OAuth
- Endpoint: `https://<gateway-id>.gateway.bedrock-agentcore.<region>.amazonaws.com/mcp`

This example demonstrates how to pass AWS credentials from the Lambda execution role
to the wrapped MCP server subprocess. See the main README for more details.
