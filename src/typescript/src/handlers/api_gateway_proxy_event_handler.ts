import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  StreamableHttpHandler,
  ParsedHttpRequest,
  HttpResponse,
} from "./streamable_http_handler.js";
import { RequestHandler } from "./request_handler.js";

/**
 * Handler for API Gateway V1 events (REST APIs)
 *
 * This handler processes APIGatewayProxyEvent events (Lambda proxy integration behind API Gateway REST API)
 * and returns APIGatewayProxyResult responses.
 *
 * This class handles all the generic JSON-RPC protocol aspects of the MCP Streamable HTTP transport:
 * - HTTP method validation (POST, OPTIONS, GET)
 * - Content-Type and Accept header validation
 * - JSON parsing and validation
 * - Batch request handling
 * - CORS headers
 * - Error response formatting
 * This class does not implement session management.
 *
 * The specific business logic is delegated to a provided RequestHandler implementation.
 */
export class APIGatewayProxyEventHandler extends StreamableHttpHandler<
  APIGatewayProxyEvent,
  APIGatewayProxyResult
> {
  constructor(requestHandler: RequestHandler) {
    super(requestHandler);
  }

  /**
   * Parse APIGatewayProxyEvent into common HTTP request format
   */
  protected parseEvent(event: APIGatewayProxyEvent): ParsedHttpRequest {
    return {
      method: event.httpMethod,
      headers: event.headers || {},
      body: event.body || null,
    };
  }

  /**
   * Format HTTP response as APIGatewayProxyResult
   */
  protected formatResponse(response: HttpResponse): APIGatewayProxyResult {
    return {
      statusCode: response.statusCode,
      headers: response.headers,
      body: response.body,
    };
  }
}
