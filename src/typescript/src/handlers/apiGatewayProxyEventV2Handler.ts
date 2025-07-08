import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import {
  StreamableHttpHandler,
  ParsedHttpRequest,
  HttpResponse,
} from "./streamableHttpHandler.js";
import { RequestHandler } from "./requestHandler.js";

/**
 * Handler for API Gateway V2 events (HTTP APIs)
 *
 * This handler processes APIGatewayProxyEventV2 events and returns APIGatewayProxyResultV2 responses.
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
export class APIGatewayProxyEventV2Handler extends StreamableHttpHandler<
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2
> {
  constructor(requestHandler: RequestHandler) {
    super(requestHandler);
  }

  /**
   * Parse APIGatewayProxyEventV2 into common HTTP request format
   */
  protected parseEvent(event: APIGatewayProxyEventV2): ParsedHttpRequest {
    return {
      method: event.requestContext.http.method,
      headers: event.headers || {},
      body: event.body || null,
    };
  }

  /**
   * Format HTTP response as APIGatewayProxyResultV2
   */
  protected formatResponse(response: HttpResponse): APIGatewayProxyResultV2 {
    return {
      statusCode: response.statusCode,
      headers: response.headers,
      body: response.body,
    };
  }
}
