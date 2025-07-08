import { Context } from 'aws-lambda';
import { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { StdioServerAdapterRequestHandler } from './stdio_server_adapter_request_handler.js';
import * as stdioServerAdapter from './stdio_server_adapter.js';

// Mock the stdioServerAdapter function
jest.mock('./stdio_server_adapter.js', () => ({
  stdioServerAdapter: jest.fn(),
}));

const mockStdioServerAdapter = stdioServerAdapter.stdioServerAdapter as jest.MockedFunction<
  typeof stdioServerAdapter.stdioServerAdapter
>;

const mockServerParams: StdioServerParameters = {
  command: 'node',
  args: ['test-server.js'],
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

describe('StdioServerAdapterRequestHandler', () => {
  let handler: StdioServerAdapterRequestHandler;

  beforeEach(() => {
    handler = new StdioServerAdapterRequestHandler(mockServerParams);
    jest.clearAllMocks();
  });

  describe('handleRequest', () => {
    test('should return JSONRPCResponse when stdioServerAdapter returns valid response', async () => {
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
        params: { arg: 'value' },
      };

      const expectedResponse: JSONRPCResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { success: true },
      };

      mockStdioServerAdapter.mockResolvedValue(expectedResponse);

      const result = await handler.handleRequest(request, mockContext);

      expect(mockStdioServerAdapter).toHaveBeenCalledWith(
        mockServerParams,
        request,
        mockContext
      );
      expect(result).toEqual(expectedResponse);
    });

    test('should return JSONRPCError when stdioServerAdapter returns error', async () => {
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };

      const expectedError: JSONRPCError = {
        jsonrpc: '2.0',
        error: {
          code: ErrorCode.MethodNotFound,
          message: 'Method not found',
        },
        id: 1,
      };

      mockStdioServerAdapter.mockResolvedValue(expectedError);

      const result = await handler.handleRequest(request, mockContext);

      expect(mockStdioServerAdapter).toHaveBeenCalledWith(
        mockServerParams,
        request,
        mockContext
      );
      expect(result).toEqual(expectedError);
    });

    test('should return internal error when stdioServerAdapter returns unexpected format', async () => {
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };

      const unexpectedResponse = { invalid: 'response' };
      mockStdioServerAdapter.mockResolvedValue(unexpectedResponse as unknown as JSONRPCResponse);

      const result = await handler.handleRequest(request, mockContext);

      expect(result).toEqual({
        jsonrpc: '2.0',
        error: {
          code: ErrorCode.InternalError,
          message: 'Internal error: Unexpected response format from MCP server',
          data: 'Expected JSONRPCResponse or JSONRPCError',
        },
        id: 1,
      });
    });

    test('should return internal error when stdioServerAdapter throws exception', async () => {
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };

      const error = new Error('Connection failed');
      mockStdioServerAdapter.mockRejectedValue(error);

      const result = await handler.handleRequest(request, mockContext);

      expect(result).toEqual({
        jsonrpc: '2.0',
        error: {
          code: ErrorCode.InternalError,
          message: 'Internal error',
          data: 'Connection failed',
        },
        id: 1,
      });
    });

    test('should handle non-Error exceptions', async () => {
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };

      mockStdioServerAdapter.mockRejectedValue('String error');

      const result = await handler.handleRequest(request, mockContext);

      expect(result).toEqual({
        jsonrpc: '2.0',
        error: {
          code: ErrorCode.InternalError,
          message: 'Internal error',
          data: 'Unknown error',
        },
        id: 1,
      });
    });

    test('should pass server parameters correctly to stdioServerAdapter', async () => {
      const customServerParams: StdioServerParameters = {
        command: 'python',
        args: ['custom-server.py', '--port', '8080'],
        env: { NODE_ENV: 'test' },
      };

      const customHandler = new StdioServerAdapterRequestHandler(customServerParams);

      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      };

      const response: JSONRPCResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {},
      };

      mockStdioServerAdapter.mockResolvedValue(response);

      await customHandler.handleRequest(request, mockContext);

      expect(mockStdioServerAdapter).toHaveBeenCalledWith(
        customServerParams,
        request,
        mockContext
      );
    });
  });
});
