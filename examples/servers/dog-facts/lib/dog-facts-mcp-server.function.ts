import {
  Handler,
  Context,
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from "aws-lambda";
import {
  APIGatewayProxyEventHandler,
  StdioServerAdapterRequestHandler,
} from "@aws/run-mcp-servers-with-aws-lambda";

const serverParams = {
  command: "node",
  args: [
    "/var/task/node_modules/@ivotoby/openapi-mcp-server/bin/mcp-server.js",
    "--api-base-url",
    "https://dogapi.dog/api/v2",
    "--openapi-spec",
    "./dog-facts-openapi.json",
  ],
};

const requestHandler = new APIGatewayProxyEventHandler(
  new StdioServerAdapterRequestHandler(serverParams)
);

export const handler: Handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  // To customize the handler based on the caller's identity, you can use:
  // event.requestContext.authorizer.iam

  return requestHandler.handle(event, context);
};
