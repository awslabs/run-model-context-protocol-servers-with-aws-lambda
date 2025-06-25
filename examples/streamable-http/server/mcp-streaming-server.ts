import { StreamableHTTPServerTransport } from '@aws/mcp-streamable-http-transport';
import express, { Request, Response } from 'express';
import { createMCPServer } from './mcp-server-factory.js';

// MCP Streaming Server with real-time streaming capabilities

const expressApp = express();
expressApp.use(express.json());

// Health check endpoint
expressApp.get('/', async (request: Request, response: Response) => {
  response.json({ 
    service: 'MCP Streaming Server',
    status: 'healthy',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Main MCP endpoint with streaming support
expressApp.post('/mcp', async (request: Request, response: Response) => {
  const mcpServer = createMCPServer();
  
  try {
    const streamingTransport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => undefined,
      enableJsonResponse: false,
    });
    
    await mcpServer.connect(streamingTransport);
    await streamingTransport.handleRequest(request, response, request.body);
    
    response.on('close', () => {
      streamingTransport.close();
      mcpServer.close();
    });
    
  } catch (serverError) {
    console.error('Error handling MCP streaming request:', serverError);
    
    if (!response.headersSent) {
      response.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error'
        },
        id: null,
      });
    }
  }
});

// Start server only in non-development environments
if (process.env.STAGE !== 'dev') {
  const SERVER_PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;
  
  expressApp.listen(SERVER_PORT, () => {
    console.log(`MCP Streaming Server started on port ${SERVER_PORT}`);
  });
}

export default expressApp;