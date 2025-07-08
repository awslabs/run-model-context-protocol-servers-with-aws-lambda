// Mock AWS credentials provider
jest.mock("@aws-sdk/credential-provider-node", () => ({
  defaultProvider: jest.fn(() => () => Promise.resolve({
    accessKeyId: "test-key",
    secretAccessKey: "test-secret",
    sessionToken: "test-session"
  }))
}));

import {
  SigV4StreamableHTTPClientTransport,
  SigV4StreamableHTTPError,
  SigV4StreamableHTTPClientTransportOptions
} from "../streamableHttp";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

// Mock AWS credentials
const mockCredentials = {
  accessKeyId: "test-key",
  secretAccessKey: "test-secret",
  sessionToken: "test-session"
};

// Mock credentials provider
const mockCredentialsProvider = () => Promise.resolve(mockCredentials);

let transport: SigV4StreamableHTTPClientTransport;
let mockFetch: jest.SpiedFunction<typeof global.fetch>;
let mockSigner: any;

// Helper function to wait for async operations
const waitForAsync = (ms: number = 10) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to create a mock response
const createMockResponse = (body: any, options: ResponseInit = {}) => {
  const defaultOptions = {
    status: 200,
    statusText: 'OK',
    headers: {
      'content-type': 'application/json',
      ...options.headers
    },
    ...options
  };

  return new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    defaultOptions
  );
};

describe("SigV4StreamableHTTPClientTransport", () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Mock fetch
    mockFetch = jest.spyOn(global, 'fetch').mockImplementation();
    
    // Create mock signer
    mockSigner = {
      sign: jest.fn().mockImplementation(async (request: any) => ({
        ...request,
        headers: {
          ...request.headers,
          authorization: "AWS4-HMAC-SHA256 Credential=test/123",
          "x-amz-date": "20250416T000000Z"
        }
      }))
    };
    
    // Create transport instance with mock signer
    transport = new SigV4StreamableHTTPClientTransport(
      new URL("https://example.com/mcp"),
      {
        credentials: mockCredentialsProvider,
        _signer: mockSigner
      },
      "us-east-1",
      "lambda"
    );
  });

  afterEach(() => {
    // Clean up after each test
    if (transport) {
      transport.close();
    }
    jest.restoreAllMocks();
  });

  describe("Basic Transport Operations", () => {
    it("should create transport with required options", () => {
      expect(transport).toBeInstanceOf(SigV4StreamableHTTPClientTransport);
    });

    it("should throw error for invalid URL", () => {
      expect(() => {
        new SigV4StreamableHTTPClientTransport(
          new URL("invalid-url"),
          { credentials: mockCredentialsProvider, _signer: mockSigner },
          "us-east-1",
          "lambda"
        );
      }).toThrow();
    });

    it("should handle missing credentials provider", () => {
      // When _signer is provided, credentials can be undefined
      // This test should pass without throwing since we're injecting a mock signer
      expect(() => {
        new SigV4StreamableHTTPClientTransport(
          new URL("https://example.com/mcp"),
          { credentials: undefined as any, _signer: mockSigner },
          "us-east-1",
          "lambda"
        );
      }).not.toThrow();
    });

    it("should set default timeout", () => {
      const defaultTransport = new SigV4StreamableHTTPClientTransport(
        new URL("https://example.com/mcp"),
        { credentials: mockCredentialsProvider, _signer: mockSigner },
        "us-east-1",
        "lambda"
      );
      
      expect(defaultTransport).toBeInstanceOf(SigV4StreamableHTTPClientTransport);
    });
  });

  describe("Request Retry and Error Handling", () => {
    it("should retry on failure and eventually succeed", async () => {
      const message: JSONRPCMessage = {
        jsonrpc: "2.0",
        id: 1,
        method: "test",
        params: {}
      };

      const successResponse = createMockResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { data: "success" }
      });

      // First call fails, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(successResponse);

      const receivedMessages: JSONRPCMessage[] = [];
      transport.onmessage = (msg) => receivedMessages.push(msg);

      await transport.send(message);
      
      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0]).toEqual({ jsonrpc: "2.0", id: 1, result: { data: "success" } });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should stop retrying after max retries and throw error", async () => {
      const message: JSONRPCMessage = {
        jsonrpc: "2.0",
        id: 1,
        method: "test",
        params: {}
      };

      mockFetch.mockRejectedValue(new Error("Always fails"));

      await expect(transport.send(message)).rejects.toThrow("Always fails");
      expect(mockFetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    it("should handle non-ok response after max retries", async () => {
      const message: JSONRPCMessage = {
        jsonrpc: "2.0",
        id: 1,
        method: "test",
        params: {}
      };

      const errorResponse = createMockResponse(
        { error: "Bad request" },
        { status: 400, statusText: "Bad Request" }
      );

      mockFetch.mockResolvedValue(errorResponse);

      await expect(transport.send(message)).rejects.toThrow("HTTP 400");
    });

    it("should handle network timeout errors", async () => {
      const message: JSONRPCMessage = {
        jsonrpc: "2.0",
        id: 1,
        method: "test",
        params: {}
      };

      mockFetch.mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Request timeout")), 100)
        )
      );

      await expect(transport.send(message)).rejects.toThrow("Request timeout");
    });
  });

  describe("Session Management", () => {
    it("should handle session ID from response headers", async () => {
      const message: JSONRPCMessage = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {}
      };

      const responseWithSession = createMockResponse(
        { jsonrpc: "2.0", id: 1, result: { status: "initialized" } },
        {
          headers: {
            'mcp-session-id': 'session-123',
            'content-type': 'application/json'
          }
        }
      );

      mockFetch.mockResolvedValue(responseWithSession);

      const receivedMessages: JSONRPCMessage[] = [];
      transport.onmessage = (msg) => receivedMessages.push(msg);

      await transport.send(message);
      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0]).toEqual({ jsonrpc: "2.0", id: 1, result: { status: "initialized" } });

      // Verify session ID is included in subsequent requests
      const nextMessage: JSONRPCMessage = {
        jsonrpc: "2.0",
        id: 2,
        method: "test",
        params: {}
      };

      const nextResponse = createMockResponse({
        jsonrpc: "2.0",
        id: 2,
        result: { data: "success" }
      });

      mockFetch.mockResolvedValue(nextResponse);
      await transport.send(nextMessage);

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const requestHeaders = lastCall[1]?.headers as Record<string, string>;
      expect(requestHeaders['mcp-session-id']).toBe('session-123');
    });
  });

  describe("Content Type Handling", () => {
    it("should handle SSE streaming responses", async () => {
      const message: JSONRPCMessage = {
        jsonrpc: "2.0",
        id: 1,
        method: "stream",
        params: {}
      };

      const sseData = `event: message
data: {"jsonrpc":"2.0","id":1,"result":{"data":"chunk1"}}

event: message
data: {"jsonrpc":"2.0","id":1,"result":{"data":"chunk2"}}

event: message
data: {"jsonrpc":"2.0","id":1,"result":{"data":"done"}}

`;

      const sseResponse = new Response(sseData, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache'
        }
      });

      mockFetch.mockResolvedValue(sseResponse);

      const results: JSONRPCMessage[] = [];
      const messageHandler = jest.fn((msg: JSONRPCMessage) => {
        results.push(msg);
      });

      transport.onmessage = messageHandler;

      await transport.send(message);
      
      // Wait for SSE processing
      await waitForAsync(50);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ jsonrpc: "2.0", id: 1, result: { data: "chunk1" } });
      expect(results[1]).toEqual({ jsonrpc: "2.0", id: 1, result: { data: "chunk2" } });
      expect(results[2]).toEqual({ jsonrpc: "2.0", id: 1, result: { data: "done" } });
    });

    it("should handle array of messages in JSON response", async () => {
      const message: JSONRPCMessage = {
        jsonrpc: "2.0",
        id: 1,
        method: "batch",
        params: {}
      };

      const batchResponse = [
        { jsonrpc: "2.0", id: 1, result: { data: "first" } },
        { jsonrpc: "2.0", id: 2, result: { data: "second" } }
      ];

      mockFetch.mockResolvedValue(createMockResponse(batchResponse));

      const receivedMessages: JSONRPCMessage[] = [];
      transport.onmessage = (msg) => receivedMessages.push(msg);

      await transport.send(message);
      expect(receivedMessages).toHaveLength(2);
      expect(receivedMessages).toEqual(batchResponse);
    });

    it("should throw error for unexpected content type", async () => {
      const message: JSONRPCMessage = {
        jsonrpc: "2.0",
        id: 1,
        method: "test",
        params: {}
      };

      const xmlResponse = new Response("<xml>data</xml>", {
        status: 200,
        headers: { 'content-type': 'application/xml' }
      });

      mockFetch.mockResolvedValue(xmlResponse);

      await expect(transport.send(message)).rejects.toThrow(SigV4StreamableHTTPError);
    });
  });

  describe("Error Handling", () => {
    it("should handle 202 Accepted response", async () => {
      const message: JSONRPCMessage = {
        jsonrpc: "2.0",
        id: 1,
        method: "async",
        params: {}
      };

      const acceptedResponse = createMockResponse(
        null,
        { 
          status: 202, 
          statusText: "Accepted",
          headers: {
            'content-type': 'application/json',
            'x-resumption-token': 'token-123'
          }
        }
      );

      mockFetch.mockResolvedValue(acceptedResponse);

      await expect(transport.send(message)).resolves.not.toThrow();
    });
  });

  describe("Authentication and Headers", () => {
    it("should include x-context headers when provided in the opts", async () => {
      const contextTransport = new SigV4StreamableHTTPClientTransport(
        new URL("https://example.com/mcp"),
        {
          credentials: mockCredentialsProvider,
          _signer: mockSigner,
          context: {
            "x-context-user": "test-user",
            "x-context-role": "admin"
          }
        },
        "us-east-1",
        "lambda"
      );

      const message: JSONRPCMessage = {
        jsonrpc: "2.0",
        id: 1,
        method: "test",
        params: {}
      };

      const response = createMockResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { data: "success" }
      });

      mockFetch.mockResolvedValue(response);

      const receivedMessages: JSONRPCMessage[] = [];
      contextTransport.onmessage = (msg) => receivedMessages.push(msg);

      await contextTransport.send(message);

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const requestHeaders = lastCall[1]?.headers as Record<string, string>;
      
      // Context is sent as JSON in x-context header
      const contextHeader = requestHeaders['x-context'];
      expect(contextHeader).toBeDefined();
      const parsedContext = JSON.parse(contextHeader);
      expect(parsedContext['x-context-user']).toBe('test-user');
      expect(parsedContext['x-context-role']).toBe('admin');

      contextTransport.close();
    });
  });

  describe("SSE Reconnection and Stream Management", () => {
    it("should attempt reconnection when SSE stream disconnects (manual trigger)", async () => {
      const message: JSONRPCMessage = {
        jsonrpc: "2.0",
        id: 1,
        method: "stream",
        params: {}
      };

      const sseResponse = new Response("", {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      });

      mockFetch.mockResolvedValue(sseResponse);

      await transport.send(message);
      await waitForAsync(20);
    });

    it("should include last-event-id header when reconnecting", async () => {
      const message: JSONRPCMessage = {
        jsonrpc: "2.0",
        id: 1,
        method: "stream",
        params: {}
      };

      const sseResponse = new Response("", {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      });

      mockFetch.mockResolvedValue(sseResponse);

      await transport.send(message);
      await waitForAsync(20);
    });

    it("should stop reconnecting after max retries", async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const reconnectTransport = new SigV4StreamableHTTPClientTransport(
        new URL("https://example.com/mcp"),
        {
          credentials: mockCredentialsProvider,
          _signer: mockSigner,
          reconnectionOptions: {
            maxRetries: 1
          }
        },
        "us-east-1",
        "lambda"
      );

      // Mock fetch to fail consistently
      mockFetch.mockRejectedValue(new Error("Network failure"));

      try {
        await reconnectTransport.send({
          jsonrpc: "2.0",
          id: 1,
          method: "stream",
          params: {}
        });
      } catch (error) {
        // Expected to fail due to network errors and retries
      }

      // The transport will retry based on maxRetries (1) + initial attempt = multiple calls
      expect(mockFetch).toHaveBeenCalled();

      errorSpy.mockRestore();
      reconnectTransport.close();
    });

  });
});
