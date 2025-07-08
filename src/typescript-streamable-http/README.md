# Streamable HTTP Transport for MCP with AWS Lambda

A transport implementation for the Model Context Protocol (MCP) that enables direct HTTP communication between MCP clients and servers running in AWS Lambda functions.

## Overview

This transport library provides an alternative to the stdio-based approach by implementing native HTTP communication with AWS Lambda Function URLs. It eliminates the need for stdio bridging inside Lambda functions and provides better performance, scalability, and developer experience.

## Key Features

- Native HTTP transport: Direct HTTP communication without stdio bridging
- AWS SigV4 authentication: Built-in AWS request signing for secure communication
- Context passing: Clean mechanism to pass Lambda event context to MCP tools
- Streaming support: Real-time notifications via Server-Sent Events (SSE)
- Session management: Optional stateful/stateless modes
- Automatic retry: Exponential backoff and reconnection logic
- Comprehensive error handling and logging
- Full TypeScript support with type safety

## Architecture Comparison

### Traditional Stdio Approach (AWS Labs)
```
[MCP Client] → [Lambda Invoke API] → [Lambda Function] → [stdio bridge] → [Child Process MCP Server] → [stdio response] → [Lambda Response] → [MCP Client]
```

### Streamable HTTP Approach (This Library)
```
[MCP Client] → [HTTP POST with SigV4] → [Lambda Function URL] → [StreamableHTTPServerTransport] → [MCP Tools with Context] → [SSE/JSON Response] → [MCP Client]
```

## Installation

```bash
npm install @aws/mcp-streamable-http-transport
```

## Quick Start

### Server Implementation

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport, extractContextFiled } from '@aws/mcp-streamable-http-transport';
import express from 'express';

// Create MCP Server
const mcpServer = new McpServer(
    { name: 'my-server', version: '1.0.0' },
    { capabilities: { logging: {} } }
);

// Add tool that uses context
mcpServer.tool('get-user-info', 'Gets user information', {}, async () => {
    const context = extractContextFiled<{
        requesterEmployeeId: string;
        requesterEmployeeAlias: string;
    }>(mcpServer, 'context');
    
    return {
        content: [{
            type: 'text',
            text: `User: ${context?.requesterEmployeeAlias}`
        }]
    };
});

// Setup Express app for Lambda Function URL
const app = express();
app.use(express.json());

const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => undefined, // Stateless mode
    enableJsonResponse: false // Use SSE streaming
});

await transport.start();
await mcpServer.connect(transport);

app.all('/mcp', async (req, res) => {
    await transport.handleRequest(req, res);
});

app.listen(3000);
```

### Client Implementation

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@aws/mcp-streamable-http-transport';

const transport = new StreamableHTTPClientTransport(
    new URL('https://your-lambda-function-url.lambda-url.us-west-2.on.aws/mcp'),
    { 
        context: {
            requesterEmployeeId: 'emp123',
            requesterEmployeeAlias: 'john.doe'
        }
    },
    'us-west-2',
    'lambda'
);

const client = new Client(
    { name: 'my-client', version: '1.0.0' },
    { capabilities: { sampling: {} } }
);

await client.connect(transport);
const result = await client.callTool({ name: 'get-user-info', arguments: {} });
await client.close();
```

## Advanced Features

### Context Passing

The transport automatically passes context from client to server via HTTP headers:

```typescript
// Client side - context is sent in x-context header
const transport = new StreamableHTTPClientTransport(url, { 
    context: { userId: '123', role: 'admin' } 
}, region, service);

// Server side - extract context in tools
const context = extractContextFiled<{ userId: string; role: string }>(server, 'context');
```

### Streaming Notifications

Support for real-time streaming via Server-Sent Events:

```typescript
// Server side - send notifications during tool execution
mcpServer.tool('long-task', 'Performs a long task', {}, async (args, { sendNotification }) => {
    for (let i = 0; i < 10; i++) {
        await sendNotification({
            method: 'notifications/message',
            params: { level: 'info', data: `Progress: ${i}/10` }
        });
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return { content: [{ type: 'text', text: 'Task completed!' }] };
});

// Client side - handle streaming notifications
transport.onmessage = (message) => {
    if ('method' in message && message.method === 'notifications/message') {
        console.log('Progress:', message.params?.data);
    }
};
```

### Session Management

Choose between stateful and stateless modes:

```typescript
// Stateless mode (recommended for Lambda)
const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => undefined
});

// Stateful mode (maintains session across requests)
const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID()
});
```

## AWS Lambda Deployment

### Lambda Function Handler

```typescript
import { APIGatewayProxyHandler } from 'aws-lambda';
import { app } from './server-example.js';
import serverless from 'serverless-http';

export const handler: APIGatewayProxyHandler = serverless(app);
```

### CDK Deployment

```typescript
import { Function, FunctionUrl, FunctionUrlAuthType } from 'aws-cdk-lib/aws-lambda';

const mcpFunction = new Function(this, 'MCPFunction', {
    // ... function configuration
});

const functionUrl = new FunctionUrl(this, 'MCPFunctionUrl', {
    function: mcpFunction,
    authType: FunctionUrlAuthType.AWS_IAM,
    cors: {
        /* Note - '*' here is for POC only, this may not pass security checks for enterprises and they may need to allowlist specific domains in some scenarios */
        allowedOrigins: ['*'],
        allowedMethods: [HttpMethod.ALL],
        allowedHeaders: ['*']
    }
});
```

## Performance Benefits

- **Reduced Cold Start**: No child process spawning
- **Lower Memory Usage**: No stdio buffering overhead  
- **Better Scalability**: Native HTTP connection pooling
- **Faster Response Times**: Direct Lambda-to-Lambda communication
- **Cost Effective**: No API Gateway charges when using Function URLs

## Error Handling

The transport includes comprehensive error handling:

```typescript
transport.onerror = (error) => {
    console.error('Transport error:', error);
};

// Automatic retry with exponential backoff
const transport = new StreamableHTTPClientTransport(url, {
    reconnectionOptions: {
        maxRetries: 5,
        initialReconnectionDelay: 1000,
        maxReconnectionDelay: 30000,
        reconnectionDelayGrowFactor: 2
    }
}, region, service);
```

## Examples

See the [examples directory](../../examples/streamable-http/) for complete working examples:

- `server/mcp-streaming-server.ts` - Complete MCP server with context extraction
- `client/mcp-streaming-client.ts` - MCP client with streaming notifications
- `package.json` - Dependencies and scripts

## API Reference

### StreamableHTTPClientTransport

Constructor options:
- `url: URL` - The MCP server endpoint URL
- `options: StreamableHTTPClientTransportOptions` - Transport configuration
- `region: string` - AWS region
- `service: string` - AWS service name ('lambda')

### StreamableHTTPServerTransport  

Constructor options:
- `sessionIdGenerator: () => string | undefined` - Session ID generator function
- `enableJsonResponse?: boolean` - Use JSON responses instead of SSE
- `onsessioninitialized?: (sessionId: string) => void` - Session callback

### Context Extraction

- `extractContext<T>(server: McpServer): T | undefined` - Extract full context
- `extractContextFiled<T>(server: McpServer, key: string): T | undefined` - Extract specific field

## Contributing

This transport library is designed to be contributed back to the AWS Labs MCP project. It provides a more robust and production-ready alternative to the stdio-based approach.

## License

Apache-2.0 License