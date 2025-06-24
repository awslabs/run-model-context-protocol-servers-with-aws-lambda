# mcpdoc MCP Server Lambda Example

This example demonstrates running the [mcpdoc MCP server](https://github.com/langchain-ai/mcpdoc) in AWS Lambda.
The mcpdoc server provides access to documentation via llms.txt files.

## Sample inputs

```bash
uv pip install -r function/requirements.txt

# Initialize
$ python -c 'from function import index; print(index.handler({"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{"roots":{"listChanged":True}},"clientInfo":{"name":"mcp","version":"0.1.0"}},"jsonrpc":"2.0","id":0}, ""))'

# List tools
$ python -c 'from function import index; print(index.handler({"method":"tools/list","params":{"clientInfo":{"name":"mcp","version":"0.1.0"}},"jsonrpc":"2.0","id":0}, ""))'

# List documentation sources
$ python -c 'from function import index; print(index.handler({"method":"tools/invoke","params":{"name":"list_doc_sources","parameters":{}},"jsonrpc":"2.0","id":0}, ""))'

# Fetch documentation
$ python -c 'from function import index; print(index.handler({"method":"tools/invoke","params":{"name":"fetch_docs","parameters":{"url":"https://strandsagents.com/latest/llms.txt"}},"jsonrpc":"2.0","id":0}, ""))'
```

## Configuration

The mcpdoc server is configured with the following options:

- `--urls`: Specifies the llms.txt files to use, in the format `Name:URL`. In this example, we use `Strands:https://strandsagents.com/latest/llms.txt`.
- `--allowed-domains`: Specifies which domains the server is allowed to fetch documentation from. In this example, we allow `strandsagents.com`.

For more configuration options, see the [mcpdoc GitHub repository](https://github.com/langchain-ai/mcpdoc).
