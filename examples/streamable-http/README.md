# MCP Streaming Transport

This directory contains implementations of Model Context Protocol (MCP) streaming transport with real-time notification support.

## Project Structure

```
streamable-http/
├── server/                          # Server-side components
│   ├── mcp-streaming-server.ts      # Main MCP streaming server
│   ├── mcp-server-factory.ts       # Server factory with configuration
│   └── mcp-tools.ts                # Tool implementations (calculator & streaming)
├── client/                          # Client-side components
│   └── mcp-streaming-client.ts      # Streaming client
├── package.json                     # Project configuration
├── tsconfig.json                    # TypeScript configuration
└── README.md                        # This file
```

## Features

### Server Features
- Real-time streaming with Server-Sent Events (SSE)
- Health check endpoint
- Error handling and logging
- Automatic resource cleanup
- Environment configuration support

### Client Features
- Real-time notification handling
- Connection lifecycle management
- Error handling and reporting
- Performance metrics tracking
- Full TypeScript support

### Transport Features
- Clean production code
- Essential logging only
- Performance optimized

## Installation

```bash
npm install
```

## Development

### Start the Server
```bash
npm run dev:server
```
Server starts on `http://localhost:8080` with endpoints:
- `GET /` - Health check
- `POST /mcp` - Main MCP streaming endpoint

### Run the Client
```bash
npm run dev:client
```

### Run Integration Test
```bash
npm run test:streaming
```

## Production Deployment

### Build
```bash
npm run build
```

### Start Server
```bash
npm run start:server
```

### Start Client
```bash
npm run start:client
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `8080` |
| `STAGE` | Deployment stage | `production` |

### Server Configuration

The server supports these endpoints:
- `GET /` - Health check endpoint
- `POST /mcp` - Main MCP streaming endpoint with SSE support

### Client Configuration

```typescript
const clientConfig: MCPClientConfig = {
  serverName: 'amazon-mcp-streaming-server',
  serverVersion: '1.0.0',
  endpoint: 'http://localhost:8080/mcp',
  region: 'us-west-2',
  service: 'lambda'
};
```

## Available Tools

### Calculator Tool
- **Name**: `calculate`
- **Description**: Performs basic arithmetic operations
- **Arguments**:
  - `operation`: 'add' | 'subtract' | 'multiply' | 'divide'
  - `operandA`: number
  - `operandB`: number

### Streaming Counter Tool
- **Name**: `count-with-notifications`
- **Description**: Demonstrates real-time streaming notifications
- **Arguments**:
  - `maxCount`: number (1-10) - Maximum number to count to
- **Behavior**: Sends real-time notifications for each count, then returns final result

## Usage Examples

### Server Usage

```typescript
import { createMCPServer } from './server/mcp-server-factory.js';
import { StreamableHTTPServerTransport } from '@aws/mcp-streamable-http-transport';

const mcpServer = createMCPServer({
  serverName: 'my-mcp-server',
  serverVersion: '1.0.0',
  enableLogging: true
});

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => undefined,
  enableJsonResponse: false
});

await mcpServer.connect(transport);
```

### Client Usage

```typescript
import { MCPStreamingClient } from './client/mcp-streaming-client.js';

const client = new MCPStreamingClient({
  serverName: 'amazon-mcp-streaming-server',
  serverVersion: '1.0.0',
  endpoint: 'http://localhost:8080/mcp'
});

await client.connect();

const result = await client.executeStreamingTool('count-with-notifications', {
  maxCount: 5
});

console.log('Final result:', result);
await client.disconnect();
```

## API Reference

### MCPStreamingClient

#### Constructor
```typescript
constructor(config: MCPClientConfig)
```

#### Methods
- `connect(): Promise<void>` - Connect to MCP server
- `executeStreamingTool(name: string, args: object): Promise<StreamingToolResult>` - Execute streaming tool
- `disconnect(): Promise<void>` - Disconnect from server

### Types

```typescript
interface MCPClientConfig {
  serverName: string;
  serverVersion: string;
  endpoint: string;
  region?: string;
  service?: string;
}

interface StreamingToolResult {
  success: boolean;
  content?: any;
  error?: string;
  notificationCount?: number;
}
```

## License

This project is part of the AWS MCP Streamable HTTP Transport package.