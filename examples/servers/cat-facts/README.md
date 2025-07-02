Sample inputs:

```bash
$ npm run build
$ export LOG_LEVEL=debug

# Initialize
$ node -e 'require("./lib/cat-facts-mcp-server.function.js").handler({"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{"roots":{"listChanged":true}},"clientInfo":{"name":"mcp","version":"0.1.0"}},"jsonrpc":"2.0","id":0}, "")'

# List tools
$ node -e 'require("./lib/cat-facts-mcp-server.function.js").handler({"method":"tools/list","params":{"clientInfo":{"name":"mcp","version":"0.1.0"}},"jsonrpc":"2.0","id":0}, "")'

# Get a random cat fact
$ node -e 'require("./lib/cat-facts-mcp-server.function.js").handler({"method":"tools/call","params":{"name":"getRandomFact","arguments":{}},"jsonrpc":"2.0","id":0}, "")'
```
