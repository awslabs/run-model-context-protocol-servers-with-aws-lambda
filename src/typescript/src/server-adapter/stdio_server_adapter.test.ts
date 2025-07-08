import {
  JSONRPCError,
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Context } from 'aws-lambda';
import { stdioServerAdapter } from './stdio_server_adapter.js';

const serverParameters: StdioServerParameters = {
  command: 'npx',
  args: ['tsx', 'test-stdio-server/echo_server.ts'],
};

const mockContext: Context = {
  callbackWaitsForEmptyEventLoop: true,
  functionName: 'test-function',
  functionVersion: '1',
  invokedFunctionArn: 'test-arn',
  memoryLimitInMB: '128',
  awsRequestId: 'test-id',
  logGroupName: 'test-group',
  logStreamName: 'test-stream',
  getRemainingTimeInMillis: () => 1000,
  done: () => {},
  fail: () => {},
  succeed: () => {},
};

test('should respond to pings', async () => {
  const pingMessage: JSONRPCRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'ping',
  };

  const expectedResponse: JSONRPCResponse = {
    jsonrpc: '2.0',
    id: 1,
    result: {},
  };

  const response = (await stdioServerAdapter(
    serverParameters,
    pingMessage,
    mockContext
  )) as JSONRPCResponse;

  expect(response).toEqual(expectedResponse);
});

test('should respond to initialize', async () => {
  const initializeMessage: JSONRPCRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mcp', version: '0.1.0' },
    },
  };

  const response = (await stdioServerAdapter(
    serverParameters,
    initializeMessage,
    mockContext
  )) as JSONRPCResponse;

  expect(response.jsonrpc).toEqual('2.0');
  expect(response.id).toEqual(1);
  expect(response).toHaveProperty('result');
});

test('should list tools', async () => {
  const listToolsMessage: JSONRPCRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  };

  const expectedResponse: JSONRPCResponse = {
    jsonrpc: '2.0',
    id: 1,
    result: {
      tools: [
        {
          name: 'echo',
          inputSchema: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            additionalProperties: false,
            properties: {
              message: { type: 'string' },
            },
            required: ['message'],
            type: 'object',
          },
        },
      ],
    },
  };

  const response = (await stdioServerAdapter(
    serverParameters,
    listToolsMessage,
    mockContext
  )) as JSONRPCResponse;

  expect(response).toEqual(expectedResponse);
});

test('should call a tool', async () => {
  const callToolsMessage: JSONRPCRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'echo',
      arguments: {
        message: 'Hello world',
      },
    },
  };

  const expectedResponse: JSONRPCResponse = {
    jsonrpc: '2.0',
    id: 1,
    result: {
      content: [{ type: 'text', text: 'Echo: Hello world' }],
    },
  };

  const response = (await stdioServerAdapter(
    serverParameters,
    callToolsMessage,
    mockContext
  )) as JSONRPCResponse;

  expect(response).toEqual(expectedResponse);
});

test('accepts a notification', async () => {
  const notification: JSONRPCNotification = {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  };

  const response = (await stdioServerAdapter(
    serverParameters,
    notification,
    mockContext
  )) as JSONRPCResponse;

  expect(response).toEqual({});
});

test('return error for invalid request', async () => {
  const invalidRequest: JSONRPCError = {
    jsonrpc: '2.0',
    id: 1,
    error: {
      code: 400,
      message: 'Invalid request',
    },
  };

  const expectedResponse: JSONRPCError = {
    jsonrpc: '2.0',
    id: 0,
    error: {
      code: ErrorCode.InvalidRequest,
      message:
        'Request is neither a valid JSON-RPC request nor a valid JSON-RPC notification',
    },
  };

  const response = (await stdioServerAdapter(
    serverParameters,
    invalidRequest,
    mockContext
  )) as JSONRPCResponse;

  expect(response).toEqual(expectedResponse);
});

test('return internal failure for invalid server params', async () => {
  const invalidServerParams: StdioServerParameters = {
    command: 'does-not-exist',
  };

  const pingMessage: JSONRPCRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'ping',
  };

  const expectedResponse: JSONRPCError = {
    jsonrpc: '2.0',
    id: 1,
    error: {
      code: 500,
      message: 'Internal failure, please check Lambda function logs',
    },
  };

  const response = (await stdioServerAdapter(
    invalidServerParams,
    pingMessage,
    mockContext
  )) as JSONRPCResponse;

  expect(response).toEqual(expectedResponse);
});

test('return error for unknown method', async () => {
  const invalidMessage: JSONRPCRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'does-not-exist',
  };

  const expectedResponse: JSONRPCError = {
    jsonrpc: '2.0',
    id: 1,
    error: {
      code: ErrorCode.MethodNotFound,
      message: 'MCP error -32601: Method not found',
    },
  };

  const response = (await stdioServerAdapter(
    serverParameters,
    invalidMessage,
    mockContext
  )) as JSONRPCResponse;

  expect(response).toEqual(expectedResponse);
});

test('return error for unknown tool call', async () => {
  const callToolsMessage: JSONRPCRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'does-not-exist',
      arguments: {
        message: 'Hello world',
      },
    },
  };

  const expectedResponse: JSONRPCError = {
    jsonrpc: '2.0',
    id: 1,
    error: {
      code: ErrorCode.InvalidParams,
      message:
        'MCP error -32602: MCP error -32602: Tool does-not-exist not found',
    },
  };

  const response = (await stdioServerAdapter(
    serverParameters,
    callToolsMessage,
    mockContext
  )) as JSONRPCResponse;

  expect(response).toEqual(expectedResponse);
});
