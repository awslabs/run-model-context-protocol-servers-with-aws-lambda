# Zen Remote MCP Server

This remote MCP server uses Bedrock AgentCore Gateway's built-in support for OpenAPI targets.
The gateway is configured with a simplified OpenAPI
specification for the [ZenQuotes](https://zenquotes.io/) API.

- Language: N/A
- Transport: Streamable HTTP transport
- Authentication: OAuth
- Endpoint: Bedrock AgentCore Gateway

### Deploy

```bash
uv pip install -r requirements.txt

python setup_gateway.py
```

See the [development guide](/DEVELOP.md) for full instructions to deploy and run the examples in this repository.
