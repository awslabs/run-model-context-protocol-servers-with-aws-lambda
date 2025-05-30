Sample inputs:

```bash
uv pip install -r function/requirements.txt

# Initialize
$ python -c 'from function import index; print(index.handler({"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{"roots":{"listChanged":True}},"clientInfo":{"name":"mcp","version":"0.1.0"}},"jsonrpc":"2.0","id":0}, ""))'

# List tools
$ python -c 'from function import index; print(index.handler({"method":"tools/list","params":{"clientInfo":{"name":"mcp","version":"0.1.0"}},"jsonrpc":"2.0","id":0}, ""))'
```
