import {
  Context,
} from "aws-lambda";
import {
  JSONRPCMessage,
  JSONRPCError,
  isJSONRPCRequest,
  isJSONRPCResponse,
  isJSONRPCError,
  isJSONRPCNotification,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { createLogger, format, transports } from 'winston';
import { RequestHandler } from "./request_handler.js";

const logger = createLogger({
  level: process.env.LOG_LEVEL?.toLowerCase() || 'info',
  format: format.simple(),
  transports: [new transports.Console()],
});

/**
 * Parsed HTTP request data extracted from various Lambda event types
 */
export interface ParsedHttpRequest {
  method: string;
  headers: Record<string, string | undefined>;
  body: string | null;
}

/**
 * HTTP response data that can be formatted for different Lambda event types
 */
export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Abstract base class for MCP Streamable HTTP protocol handlers in Lambda functions
 *
 * This class handles all the generic JSON-RPC protocol aspects:
 * - HTTP method validation (POST, OPTIONS, GET)
 * - Content-Type and Accept header validation
 * - JSON parsing and validation
 * - Batch request handling
 * - CORS headers
 * - Error response formatting
 * This class does not implement session management.
 *
 * The specific business logic is delegated to a RequestHandler implementation.
 * Event-specific parsing and response formatting is handled by concrete subclasses.
 */
export abstract class StreamableHttpHandler<TEvent, TResult> {
  constructor(protected requestHandler: RequestHandler) {}

  /**
   * Main handler method that processes Lambda events.
   * Concrete implementations should call this after parsing the event.
   */
  async handle(event: TEvent, context: Context): Promise<TResult> {
    try {
      logger.debug("Incoming event:", JSON.stringify(event, null, 2));

      // Parse the event into a common HTTP request format
      const httpRequest = this.parseEvent(event);
      
      // Process the HTTP request using shared logic
      const httpResponse = await this.processHttpRequest(httpRequest, context);
      
      // Format the response for the specific event type
      return this.formatResponse(httpResponse);
    } catch (error) {
      logger.error("Error processing MCP Streamable HTTP request:", error);

      return this.formatResponse(
        this.createErrorHttpResponse(
          500,
          ErrorCode.InternalError,
          "Internal error",
          {},
          error instanceof Error ? error.message : "Unknown error"
        )
      );
    }
  }

  /**
   * Parse the Lambda event into a common HTTP request format
   * Must be implemented by concrete subclasses
   */
  protected abstract parseEvent(event: TEvent): ParsedHttpRequest;

  /**
   * Format the HTTP response for the specific Lambda event type
   * Must be implemented by concrete subclasses
   */
  protected abstract formatResponse(response: HttpResponse): TResult;

  /**
   * Process the HTTP request using shared MCP Streamable HTTP logic
   */
  protected async processHttpRequest(
    httpRequest: ParsedHttpRequest,
    context: Context
  ): Promise<HttpResponse> {
    // Handle different HTTP methods according to MCP Streamable HTTP spec
    logger.debug("Detected HTTP method:", httpRequest.method);

    if (httpRequest.method === "OPTIONS") {
      // Handle CORS preflight
      return this.createCorsHttpResponse();
    }

    if (httpRequest.method === "GET") {
      // No support for SSE streaming in Lambda functions
      // Return 405 Method Not Allowed as per spec
      return this.createErrorHttpResponse(
        405,
        ErrorCode.ConnectionClosed,
        "Method Not Allowed: SSE streaming not supported",
        { Allow: "POST, OPTIONS" }
      );
    }

    if (httpRequest.method !== "POST") {
      return this.createErrorHttpResponse(
        405,
        ErrorCode.ConnectionClosed,
        "Method Not Allowed",
        { Allow: "POST, OPTIONS" }
      );
    }

    // Validate Accept header for POST requests
    const acceptHeader = this.getHeaderValue(httpRequest.headers, "accept");
    if (!acceptHeader?.includes("application/json")) {
      return this.createErrorHttpResponse(
        406,
        ErrorCode.ConnectionClosed,
        "Not Acceptable: Client must accept application/json"
      );
    }

    // Validate Content-Type header
    const contentType = this.getHeaderValue(httpRequest.headers, "content-type");
    if (!contentType?.includes("application/json")) {
      return this.createErrorHttpResponse(
        415,
        ErrorCode.ConnectionClosed,
        "Unsupported Media Type: Content-Type must be application/json"
      );
    }

    // Parse the request body according to MCP Streamable HTTP spec
    if (!httpRequest.body) {
      return this.createErrorHttpResponse(
        400,
        ErrorCode.ParseError,
        "Parse error: Empty request body"
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(httpRequest.body);
    } catch {
      return this.createErrorHttpResponse(
        400,
        ErrorCode.ParseError,
        "Parse error: Invalid JSON"
      );
    }

    // Handle both single messages and batches according to MCP spec
    let messages: unknown[];
    if (Array.isArray(parsedBody)) {
      messages = parsedBody;
    } else {
      messages = [parsedBody];
    }

    // Validate that all messages are valid JSON-RPC using schema validation
    const validatedMessages: JSONRPCMessage[] = [];
    for (const message of messages) {
      if (
        isJSONRPCRequest(message) ||
        isJSONRPCResponse(message) ||
        isJSONRPCError(message) ||
        isJSONRPCNotification(message)
      ) {
        validatedMessages.push(message);
      } else {
        return this.createErrorHttpResponse(
          400,
          ErrorCode.InvalidRequest,
          "Invalid Request: All messages must be valid JSON-RPC 2.0"
        );
      }
    }

    // Check if any message is a request (vs notification/response)
    const hasRequests = validatedMessages.some(isJSONRPCRequest);

    if (!hasRequests) {
      // If it only contains notifications or responses, return 202 Accepted
      return {
        statusCode: 202,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
        body: "",
      };
    }

    // Process requests - for Lambda, we'll process them sequentially and return JSON
    const responses: JSONRPCMessage[] = [];

    for (const message of validatedMessages) {
      if (isJSONRPCRequest(message)) {
        try {
          // Delegate to the specific request handler
          const response = await this.requestHandler.handleRequest(
            message,
            context
          );

          // The handler should return JSONRPCResponse or JSONRPCError for requests
          if (isJSONRPCResponse(response) || isJSONRPCError(response)) {
            responses.push(response);
          } else {
            // Unexpected response format - return internal server error
            logger.error(
              "Unexpected response format from request handler:",
              response
            );
            const errorResponse: JSONRPCError = {
              jsonrpc: "2.0",
              error: {
                code: ErrorCode.InternalError,
                message:
                  "Internal error: Unexpected response format from request handler",
                data: "Expected JSONRPCResponse or JSONRPCError",
              },
              id: message.id,
            };
            responses.push(errorResponse);
          }
        } catch (error) {
          // Return JSON-RPC error response
          const errorResponse: JSONRPCError = {
            jsonrpc: "2.0",
            error: {
              code: ErrorCode.InternalError,
              message: "Internal error",
              data: error instanceof Error ? error.message : "Unknown error",
            },
            id: message.id,
          };
          responses.push(errorResponse);
        }
      }
    }

    // Prepare response headers
    const responseHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version",
    };

    // Return the response(s)
    const responseBody = responses.length === 1 ? responses[0] : responses;

    return {
      statusCode: 200,
      headers: responseHeaders,
      body: JSON.stringify(responseBody),
    };
  }

  /**
   * Get header value in a case-insensitive way
   */
  protected getHeaderValue(
    headers: Record<string, string | undefined>,
    headerName: string
  ): string | undefined {
    // Try exact match first
    if (headers[headerName] !== undefined) {
      return headers[headerName];
    }

    // Try case-insensitive match
    const lowerHeaderName = headerName.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === lowerHeaderName) {
        return value;
      }
    }

    return undefined;
  }

  /**
   * Create a CORS preflight HTTP response
   */
  protected createCorsHttpResponse(): HttpResponse {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version",
      },
      body: "",
    };
  }

  /**
   * Create an error HTTP response with proper CORS headers
   */
  protected createErrorHttpResponse(
    statusCode: number,
    errorCode: ErrorCode,
    message: string,
    additionalHeaders: Record<string, string> = {},
    data?: unknown
  ): HttpResponse {
    return {
      statusCode,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        ...additionalHeaders,
      },
      body: JSON.stringify(
        this.createJSONRPCErrorResponse(errorCode, message, data)
      ),
    };
  }

  /**
   * Helper function to create JSON-RPC error responses with no ID
   */
  protected createJSONRPCErrorResponse(
    code: ErrorCode,
    message: string,
    data?: unknown
  ) {
    return {
      jsonrpc: "2.0" as const,
      error: {
        code,
        message,
        ...(data !== undefined && { data }),
      },
      id: null,
    };
  }
}
