import {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyResult,
  APIGatewayProxyResultV2,
  Context,
} from "aws-lambda";
import {
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import {
  APIGatewayProxyEventHandler,
  APIGatewayProxyEventV2Handler,
  LambdaFunctionURLEventHandler,
} from "./index.js";
import { RequestHandler } from "./request_handler.js";

// Mock RequestHandler implementation for testing
class MockRequestHandler implements RequestHandler {
  private responses: Map<string, JSONRPCResponse | JSONRPCError> = new Map();
  private shouldThrow = false;

  setResponse(method: string, response: JSONRPCResponse | JSONRPCError) {
    this.responses.set(method, response);
  }

  setShouldThrow(shouldThrow: boolean) {
    this.shouldThrow = shouldThrow;
  }

  async handleRequest(
    request: JSONRPCRequest,
    _context: Context
  ): Promise<JSONRPCResponse | JSONRPCError> {
    if (this.shouldThrow) {
      throw new Error("Mock handler error");
    }

    const response = this.responses.get(request.method);
    if (!response) {
      return {
        jsonrpc: "2.0",
        error: {
          code: ErrorCode.MethodNotFound,
          message: "Method not found",
        },
        id: request.id,
      };
    }

    return response;
  }
}

// Mock Lambda context
const mockContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: "test-function",
  functionVersion: "1",
  invokedFunctionArn:
    "arn:aws:lambda:us-east-1:123456789012:function:test-function",
  memoryLimitInMB: "128",
  awsRequestId: "test-request-id",
  logGroupName: "/aws/lambda/test-function",
  logStreamName: "test-stream",
  getRemainingTimeInMillis: () => 30000,
  done: () => {},
  fail: () => {},
  succeed: () => {},
};

// Helper functions to create mock events
function createMockAPIGatewayProxyEvent(
  httpMethod: string,
  body: string | null = null,
  headers: Record<string, string> = {}
): APIGatewayProxyEvent {
  return {
    httpMethod,
    headers,
    body,
    path: "/test",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    multiValueHeaders: {},
    stageVariables: null,
    requestContext: {
      accountId: "123456789012",
      apiId: "test-api",
      protocol: "HTTP/1.1",
      httpMethod,
      path: "/test",
      stage: "test",
      requestId: "test-request",
      requestTime: "01/Jan/2023:00:00:00 +0000",
      requestTimeEpoch: 1672531200,
      authorizer: {},
      identity: {
        cognitoIdentityPoolId: null,
        accountId: null,
        cognitoIdentityId: null,
        caller: null,
        sourceIp: "127.0.0.1",
        principalOrgId: null,
        accessKey: null,
        cognitoAuthenticationType: null,
        cognitoAuthenticationProvider: null,
        userArn: null,
        userAgent: "test-agent",
        user: null,
        apiKey: null,
        apiKeyId: null,
        clientCert: null,
      },
      resourceId: "test-resource",
      resourcePath: "/test",
    },
    resource: "/test",
    isBase64Encoded: false,
  };
}

function createMockAPIGatewayProxyEventV2(
  httpMethod: string,
  body: string | null = null,
  headers: Record<string, string> = {},
  routeKey: string = `${httpMethod} /test`
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey,
    rawPath: "/test",
    rawQueryString: "",
    headers,
    body: body || undefined,
    requestContext: {
      accountId: "123456789012",
      apiId: "test-api",
      domainName: "test.execute-api.us-east-1.amazonaws.com",
      domainPrefix: "test",
      stage: "test",
      requestId: "test-request",
      routeKey,
      http: {
        method: httpMethod,
        path: "/test",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test-agent",
      },
      time: "01/Jan/2023:00:00:00 +0000",
      timeEpoch: 1672531200,
    },
    isBase64Encoded: false,
  };
}

function createMockLambdaFunctionURLEvent(
  httpMethod: string,
  body: string | null = null,
  headers: Record<string, string> = {}
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/",
    rawQueryString: "",
    headers,
    body: body || undefined,
    requestContext: {
      accountId: "123456789012",
      apiId: "test-function-url",
      domainName: "test-function-url.lambda-url.us-east-1.on.aws",
      domainPrefix: "test-function-url",
      stage: "$default",
      requestId: "test-request",
      routeKey: "$default",
      http: {
        method: httpMethod,
        path: "/",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test-agent",
      },
      time: "01/Jan/2023:00:00:00 +0000",
      timeEpoch: 1672531200,
    },
    isBase64Encoded: false,
  };
}

// Test suite for all handlers
describe("MCP Streamable HTTP Handlers", () => {
  let mockRequestHandler: MockRequestHandler;

  beforeEach(() => {
    mockRequestHandler = new MockRequestHandler();
  });

  // Test cases that should work the same across all handlers
  const sharedTestCases = [
    {
      name: "APIGatewayProxyEventHandler (REST API)",
      createHandler: () => new APIGatewayProxyEventHandler(mockRequestHandler),
      createEvent: createMockAPIGatewayProxyEvent,
      validateResponse: (result: APIGatewayProxyResult) => {
        expect(result.statusCode).toBeDefined();
        expect(result.headers).toBeDefined();
        expect(result.body).toBeDefined();
      },
    },
    {
      name: "APIGatewayProxyEventV2Handler (HTTP API)",
      createHandler: () =>
        new APIGatewayProxyEventV2Handler(mockRequestHandler),
      createEvent: createMockAPIGatewayProxyEventV2,
      validateResponse: (result: APIGatewayProxyResultV2) => {
        // APIGatewayProxyResultV2 can be string or object, we expect object
        expect(typeof result).toBe("object");
        const resultObj = result as {
          statusCode: number;
          headers?: Record<string, string>;
          body: string;
        };
        expect(resultObj.statusCode).toBeDefined();
        expect(resultObj.headers).toBeDefined();
        expect(resultObj.body).toBeDefined();
      },
    },
    {
      name: "LambdaFunctionURLEventHandler",
      createHandler: () =>
        new LambdaFunctionURLEventHandler(mockRequestHandler),
      createEvent: createMockLambdaFunctionURLEvent,
      validateResponse: (result: APIGatewayProxyResultV2) => {
        // APIGatewayProxyResultV2 can be string or object, we expect object
        expect(typeof result).toBe("object");
        const resultObj = result as {
          statusCode: number;
          headers?: Record<string, string>;
          body: string;
        };
        expect(resultObj.statusCode).toBeDefined();
        expect(resultObj.headers).toBeDefined();
        expect(resultObj.body).toBeDefined();
      },
    },
  ];

  // Run shared tests for all handlers
  sharedTestCases.forEach(
    ({ name, createHandler, createEvent, validateResponse }) => {
      describe(name, () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let handler: any;

        beforeEach(() => {
          handler = createHandler();
        });

        describe("HTTP methods other than POST", () => {
          it("should handle OPTIONS request (CORS preflight)", async () => {
            const event = createEvent("OPTIONS");

            const result = await handler.handle(event, mockContext);
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(200);
            expect(resultObj.headers?.["Access-Control-Allow-Origin"]).toBe(
              "*"
            );
            expect(resultObj.headers?.["Access-Control-Allow-Methods"]).toBe(
              "POST, GET, OPTIONS"
            );
            expect(resultObj.body).toBe("");
          });

          it("should return 405 for GET requests", async () => {
            const event = createEvent("GET");

            const result = await handler.handle(event, mockContext);
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(405);
            expect(resultObj.headers?.["Allow"]).toBe("POST, OPTIONS");

            const responseBody = JSON.parse(resultObj.body);
            expect(responseBody.error.code).toBe(ErrorCode.ConnectionClosed);
            expect(responseBody.error.message).toBe(
              "Method Not Allowed: SSE streaming not supported"
            );
          });

          it("should return 405 for PUT requests", async () => {
            const event = createEvent("PUT");

            const result = await handler.handle(event, mockContext);
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(405);
            expect(resultObj.headers?.["Allow"]).toBe("POST, OPTIONS");

            const responseBody = JSON.parse(resultObj.body);
            expect(responseBody.error.code).toBe(ErrorCode.ConnectionClosed);
            expect(responseBody.error.message).toBe("Method Not Allowed");
          });

          it("should return 405 for PATCH requests", async () => {
            const event = createEvent("PATCH");

            const result = await handler.handle(event, mockContext);
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(405);
            expect(resultObj.headers?.["Allow"]).toBe("POST, OPTIONS");

            const responseBody = JSON.parse(resultObj.body);
            expect(responseBody.error.code).toBe(ErrorCode.ConnectionClosed);
            expect(responseBody.error.message).toBe("Method Not Allowed");
          });

          it("should return 405 for DELETE requests", async () => {
            const event = createEvent("DELETE");

            const result = await handler.handle(event, mockContext);
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(405);
            expect(resultObj.headers?.["Allow"]).toBe("POST, OPTIONS");

            const responseBody = JSON.parse(resultObj.body);
            expect(responseBody.error.code).toBe(ErrorCode.ConnectionClosed);
            expect(responseBody.error.message).toBe("Method Not Allowed");
          });
        });

        describe("Header validation", () => {
          it("should return 406 when missing all headers", async () => {
            const event = createEvent(
              "POST",
              JSON.stringify({
                jsonrpc: "2.0",
                method: "test",
                id: 1,
              })
            );

            const result = await handler.handle(event, mockContext);
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(406);

            const responseBody = JSON.parse(resultObj.body);
            expect(responseBody.error.code).toBe(ErrorCode.ConnectionClosed);
            expect(responseBody.error.message).toBe(
              "Not Acceptable: Client must accept application/json"
            );
          });

          it("should return 406 for missing Accept header", async () => {
            const event = createEvent(
              "POST",
              JSON.stringify({
                jsonrpc: "2.0",
                method: "test",
                id: 1,
              }),
              {
                "Content-Type": "application/json",
              }
            );

            const result = await handler.handle(event, mockContext);
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(406);

            const responseBody = JSON.parse(resultObj.body);
            expect(responseBody.error.code).toBe(ErrorCode.ConnectionClosed);
            expect(responseBody.error.message).toBe(
              "Not Acceptable: Client must accept application/json"
            );
          });

          it("should return 406 for wrong Accept content type", async () => {
            const event = createEvent(
              "POST",
              JSON.stringify({
                jsonrpc: "2.0",
                method: "test",
                id: 1,
              }),
              {
                "Content-Type": "application/json",
                Accept: "text/html",
              }
            );

            const result = await handler.handle(event, mockContext);
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(406);

            const responseBody = JSON.parse(resultObj.body);
            expect(responseBody.error.code).toBe(ErrorCode.ConnectionClosed);
            expect(responseBody.error.message).toBe(
              "Not Acceptable: Client must accept application/json"
            );
          });

          it("should return 415 for missing Content-Type", async () => {
            const event = createEvent(
              "POST",
              JSON.stringify({
                jsonrpc: "2.0",
                method: "test",
                id: 1,
              }),
              {
                Accept: "application/json",
              }
            );

            const result = await handler.handle(event, mockContext);
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(415);

            const responseBody = JSON.parse(resultObj.body);
            expect(responseBody.error.code).toBe(ErrorCode.ConnectionClosed);
            expect(responseBody.error.message).toBe(
              "Unsupported Media Type: Content-Type must be application/json"
            );
          });

          it("should return 415 for wrong Content-Type", async () => {
            const event = createEvent(
              "POST",
              JSON.stringify({
                jsonrpc: "2.0",
                method: "test",
                id: 1,
              }),
              {
                "Content-Type": "text/plain",
                Accept: "application/json",
              }
            );

            const result = await handler.handle(event, mockContext);
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(415);

            const responseBody = JSON.parse(resultObj.body);
            expect(responseBody.error.code).toBe(ErrorCode.ConnectionClosed);
            expect(responseBody.error.message).toBe(
              "Unsupported Media Type: Content-Type must be application/json"
            );
          });

          it("should accept case-insensitive headers", async () => {
            const expectedResponse: JSONRPCResponse = {
              jsonrpc: "2.0",
              result: { message: "Case insensitive headers work" },
              id: 1,
            };
            mockRequestHandler.setResponse("test", expectedResponse);

            // Test with different header casing
            const event = createEvent(
              "POST",
              JSON.stringify({
                jsonrpc: "2.0",
                method: "test",
                id: 1,
              }),
              {
                "content-type": "application/json", // lowercase
                ACCEPT: "application/json", // uppercase
              }
            );

            const result = await handler.handle(event, mockContext);
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(200);

            const responseBody = JSON.parse(resultObj.body);
            expect(responseBody.jsonrpc).toBe("2.0");
            expect(responseBody.result.message).toBe(
              "Case insensitive headers work"
            );
            expect(responseBody.id).toBe(1);
          });
        });

        describe("Request body validation", () => {
          it("should return 400 for empty request body", async () => {
            const event = createEvent("POST", null, {
              "Content-Type": "application/json",
              Accept: "application/json",
            });

            const result = await handler.handle(event, mockContext);
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(400);

            const responseBody = JSON.parse(resultObj.body);
            expect(responseBody.error.code).toBe(ErrorCode.ParseError);
            expect(responseBody.error.message).toBe(
              "Parse error: Empty request body"
            );
          });

          it("should return 400 for invalid JSON", async () => {
            const event = createEvent("POST", "invalid json", {
              "Content-Type": "application/json",
              Accept: "application/json",
            });

            const result = await handler.handle(event, mockContext);
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(400);

            const responseBody = JSON.parse(resultObj.body);
            expect(responseBody.error.code).toBe(ErrorCode.ParseError);
            expect(responseBody.error.message).toBe(
              "Parse error: Invalid JSON"
            );
          });

          it("should return 400 for invalid JSON-RPC message format", async () => {
            const event = createEvent(
              "POST",
              JSON.stringify({
                invalid: "message",
                notJsonRpc: true,
              }),
              {
                "Content-Type": "application/json",
                Accept: "application/json",
              }
            );

            const result = await handler.handle(event, mockContext);
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(400);

            const responseBody = JSON.parse(resultObj.body);
            expect(responseBody.error.code).toBe(ErrorCode.InvalidRequest);
            expect(responseBody.error.message).toBe(
              "Invalid Request: All messages must be valid JSON-RPC 2.0"
            );
          });
        });

        describe("Single request handling", () => {
          it("should handle valid JSON-RPC request and return response", async () => {
            const expectedResponse: JSONRPCResponse = {
              jsonrpc: "2.0",
              result: { message: "Hello, World!" },
              id: 1,
            };
            mockRequestHandler.setResponse("test", expectedResponse);

            const event = createEvent(
              "POST",
              JSON.stringify({
                jsonrpc: "2.0",
                method: "test",
                id: 1,
              }),
              {
                "Content-Type": "application/json",
                Accept: "application/json",
              }
            );

            const result = await handler.handle(event, mockContext);
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(200);
            expect(resultObj.headers?.["Content-Type"]).toBe(
              "application/json"
            );
            expect(resultObj.headers?.["Access-Control-Allow-Origin"]).toBe(
              "*"
            );

            const responseBody = JSON.parse(resultObj.body);
            expect(responseBody.jsonrpc).toBe("2.0");
            expect(responseBody.result.message).toBe("Hello, World!");
            expect(responseBody.id).toBe(1);
          });

          it("should handle JSON-RPC errors from request handler", async () => {
            const expectedError: JSONRPCError = {
              jsonrpc: "2.0",
              error: {
                code: ErrorCode.MethodNotFound,
                message: "Method not found",
              },
              id: 1,
            };
            mockRequestHandler.setResponse("test", expectedError);

            const event = createEvent(
              "POST",
              JSON.stringify({
                jsonrpc: "2.0",
                method: "test",
                id: 1,
              }),
              {
                "Content-Type": "application/json",
                Accept: "application/json",
              }
            );

            const result = await handler.handle(event, mockContext);
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(200);

            const responseBody = JSON.parse(resultObj.body);
            expect(responseBody.jsonrpc).toBe("2.0");
            expect(responseBody.error.code).toBe(ErrorCode.MethodNotFound);
            expect(responseBody.error.message).toBe("Method not found");
            expect(responseBody.id).toBe(1);
          });

          it("should handle exceptions from request handler", async () => {
            mockRequestHandler.setShouldThrow(true);

            const event = createEvent(
              "POST",
              JSON.stringify({
                jsonrpc: "2.0",
                method: "test",
                id: 1,
              }),
              {
                "Content-Type": "application/json",
                Accept: "application/json",
              }
            );

            const result = await handler.handle(event, mockContext);
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(200);

            const responseBody = JSON.parse(resultObj.body);
            expect(responseBody.jsonrpc).toBe("2.0");
            expect(responseBody.error.code).toBe(ErrorCode.InternalError);
            expect(responseBody.error.message).toBe("Internal error");
            expect(responseBody.error.data).toBe("Mock handler error");
            expect(responseBody.id).toBe(1);
          });

          it("should handle unexpected response format from request handler", async () => {
            // Create a handler that returns invalid response format
            const invalidHandler: RequestHandler = {
              async handleRequest() {
                return { invalid: "response" } as unknown as JSONRPCResponse;
              },
            };

            const invalidHandlerInstance = createHandler();
            // Replace the request handler with our invalid one
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (invalidHandlerInstance as any).requestHandler = invalidHandler;

            const event = createEvent(
              "POST",
              JSON.stringify({
                jsonrpc: "2.0",
                method: "test",
                id: 1,
              }),
              {
                "Content-Type": "application/json",
                Accept: "application/json",
              }
            );

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (invalidHandlerInstance as any).handle(
              event,
              mockContext
            );
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(200);

            const responseBody = JSON.parse(resultObj.body);
            expect(responseBody.jsonrpc).toBe("2.0");
            expect(responseBody.error.code).toBe(ErrorCode.InternalError);
            expect(responseBody.error.message).toBe(
              "Internal error: Unexpected response format from request handler"
            );
            expect(responseBody.error.data).toBe(
              "Expected JSONRPCResponse or JSONRPCError"
            );
            expect(responseBody.id).toBe(1);
          });

          it("should return 202 for notification event", async () => {
            const event = createEvent(
              "POST",
              JSON.stringify({
                jsonrpc: "2.0",
                method: "test",
                // No id = notification
              }),
              {
                "Content-Type": "application/json",
                Accept: "application/json",
              }
            );

            const result = await handler.handle(event, mockContext);
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(202);
            expect(resultObj.body).toBe("");
          });
        });

        describe("Batch request handling", () => {
          it("should handle batch of requests", async () => {
            const expectedResponses = [
              {
                jsonrpc: "2.0" as const,
                result: { message: "Response 1" },
                id: 1,
              },
              {
                jsonrpc: "2.0" as const,
                result: { message: "Response 2" },
                id: 2,
              },
            ];

            mockRequestHandler.setResponse("test1", expectedResponses[0]);
            mockRequestHandler.setResponse("test2", expectedResponses[1]);

            const event = createEvent(
              "POST",
              JSON.stringify([
                {
                  jsonrpc: "2.0",
                  method: "test1",
                  id: 1,
                },
                {
                  jsonrpc: "2.0",
                  method: "test2",
                  id: 2,
                },
              ]),
              {
                "Content-Type": "application/json",
                Accept: "application/json",
              }
            );

            const result = await handler.handle(event, mockContext);
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(200);

            const responseBody = JSON.parse(resultObj.body);
            expect(Array.isArray(responseBody)).toBe(true);
            expect(responseBody).toHaveLength(2);
            expect(responseBody[0].result.message).toBe("Response 1");
            expect(responseBody[1].result.message).toBe("Response 2");
          });

          it("should handle mixed batch with requests and notifications", async () => {
            const expectedResponse: JSONRPCResponse = {
              jsonrpc: "2.0",
              result: { message: "Response for request" },
              id: 1,
            };
            mockRequestHandler.setResponse("test", expectedResponse);

            const event = createEvent(
              "POST",
              JSON.stringify([
                {
                  jsonrpc: "2.0",
                  method: "test",
                  id: 1, // Request
                },
                {
                  jsonrpc: "2.0",
                  method: "notification", // Notification (no id)
                },
              ]),
              {
                "Content-Type": "application/json",
                Accept: "application/json",
              }
            );

            const result = await handler.handle(event, mockContext);
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(200);

            const responseBody = JSON.parse(resultObj.body);
            // Should return single response since only one request (the notification doesn't get a response)
            expect(responseBody.jsonrpc).toBe("2.0");
            expect(responseBody.result.message).toBe("Response for request");
            expect(responseBody.id).toBe(1);
          });

          it("should return 202 for batch of notifications only", async () => {
            const event = createEvent(
              "POST",
              JSON.stringify([
                {
                  jsonrpc: "2.0",
                  method: "notification1",
                },
                {
                  jsonrpc: "2.0",
                  method: "notification2",
                },
              ]),
              {
                "Content-Type": "application/json",
                Accept: "application/json",
              }
            );

            const result = await handler.handle(event, mockContext);
            validateResponse(result);

            const resultObj =
              typeof result === "string" ? JSON.parse(result) : result;
            expect(resultObj.statusCode).toBe(202);
            expect(resultObj.body).toBe("");
          });
        });
      });
    }
  );
});
