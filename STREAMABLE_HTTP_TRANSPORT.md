# Streamable HTTP Transport for MCP

This repository now includes a **Streamable HTTP Transport** implementation that provides an alternative to the stdio-based approach for running MCP servers in AWS Lambda.

## Why Streamable HTTP Transport?

The original stdio-based approach requires creating child processes inside Lambda functions and bridging stdio communication. The Streamable HTTP transport eliminates this complexity by implementing native HTTP communication.

### Architecture Comparison

#### Original Stdio Approach
```
[MCP Client] → [Lambda Invoke API] → [Lambda Function]
    → [stdio bridge] → [Child Process MCP Server]
    → [stdio response] → [Lambda Response] → [MCP Client]
```

#### New Streamable HTTP Approach
```
[MCP Client] → [HTTP POST with SigV4] → [HTTP Endpoint]
    → [StreamableHTTPServerTransport] → [MCP Tools with Context]
    → [SSE/JSON Response] → [MCP Client]
```

## Key Advantages

- Better performance: No child process overhead, faster cold starts
- Flexible authentication: Built-in custom auth supporting SigV4, OAuth, transitive auth, or enterprise-specific frameworks
- Real-time streaming: Server-Sent Events for notifications
- Context passing: Clean mechanism to pass HTTP request metadata to tools
- Cost effective: Direct Lambda Function URLs reduce latency and cost (though API Gateway can be added for additional features like rate limiting, caching, and request transformation)
- Comprehensive error handling, retry logic, session management

## Quick Start

### 1. Install the Transport

```bash
cd src/typescript-streamable-http
npm install
npm run build
```

### 2. Run the Examples

```bash
cd examples/streamable-http
npm install

# Start server
npm run dev:server

# In another terminal, start client
npm run dev:client
```

### 3. Deploy to AWS Lambda

The examples include complete deployment instructions for AWS Lambda with Function URLs.

## Implementation Highlights

### Server Side
```typescript
import { StreamableHTTPServerTransport, extractContextFiled } from './src/typescript-streamable-http';

const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => undefined, // Stateless for Lambda
    enableJsonResponse: false // Use SSE streaming
});

// Extract context in MCP tools
const context = extractContextFiled<UserContext>(mcpServer, 'context');
```

### Client Side
```typescript
import { StreamableHTTPClientTransport } from './src/typescript-streamable-http';

const transport = new StreamableHTTPClientTransport(
    new URL('https://your-function-url.lambda-url.us-west-2.on.aws/mcp'),
    { context: { userId: '123', role: 'admin' } }, // Pass context
    'us-west-2',
    'lambda'
);
```

## Documentation

- **[Transport Library README](src/typescript-streamable-http/README.md)** - Complete API documentation
- **[Examples README](examples/streamable-http/README.md)** - Step-by-step examples
- **[Server Example](examples/streamable-http/server-example.ts)** - Complete server implementation
- **[Client Example](examples/streamable-http/client-example.ts)** - Client with streaming support

## Comparison with Existing Approach

| Feature | Stdio Transport | Streamable HTTP Transport |
|---------|----------------|---------------------------|
| **Architecture** | Child process + stdio bridge | Native HTTP communication |
| **Cold Start** | Slower (process spawning) | Faster (direct HTTP) |
| **Memory Usage** | Higher (multiple processes) | Lower (single process) |
| **Context Passing** | Complex (environment variables) | Clean (HTTP headers) |
| **Streaming** | Limited | Full SSE support |
| **Error Handling** | Basic | Comprehensive with retry |
| **AWS Integration** | Manual invoke API | Native SigV4 + Function URLs |
| **Scalability** | Limited by process limits | HTTP connection pooling |
| **Cost** | Higher (API Gateway often needed) | Lower (direct Function URLs) |

## Migration Guide

### From Stdio to Streamable HTTP

1. **Replace transport imports**:
   ```typescript
   // Old
   import { stdioServerAdapter } from '@aws/run-mcp-servers-with-aws-lambda';
   
   // New  
   import { StreamableHTTPServerTransport } from './src/typescript-streamable-http';
   ```

2. **Update server initialization**:
   ```typescript
   // Old - stdio adapter in Lambda handler
   export const handler = (event, context) => {
       return stdioServerAdapter(serverParams, event, context);
   };
   
   // New - Express app with HTTP transport
   const app = express();
   const transport = new StreamableHTTPServerTransport({...});
   app.all('/mcp', (req, res) => transport.handleRequest(req, res));
   ```

3. **Update client connection**:
   ```typescript
   // Old - Lambda invoke transport
   const transport = new LambdaFunctionClientTransport({...});
   
   // New - HTTP transport
   const transport = new StreamableHTTPClientTransport(url, options, region, service);
   ```

## Production Deployments

The Streamable HTTP transport is already being used in production environments with:
- **Multi-stage deployments** (alpha, beta, gamma, prod)
- **Multiple MCP servers** running as separate Lambda functions
- **Real-time streaming** for long-running operations
- **Context-aware tools** that access user and request data
- **Automatic retry and reconnection** for reliability

## Contributing

This transport implementation represents a significant improvement over the stdio approach and is ready for community adoption. The code is production-tested and includes comprehensive examples and documentation.

## Next Steps

1. **Test the examples** locally
2. **Deploy to AWS Lambda** using the provided instructions  
3. **Integrate into your MCP applications**
4. **Contribute improvements** back to the community

The Streamable HTTP transport makes MCP with AWS Lambda more performant, scalable, and developer-friendly while maintaining full protocol compatibility.