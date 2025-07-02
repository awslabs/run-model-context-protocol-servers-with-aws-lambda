import {
  Handler,
  Context,
  APIGatewayProxyEventV2WithIAMAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  LambdaFunctionURLEventHandler,
  StdioServerAdapterRequestHandler,
} from "@aws/run-mcp-servers-with-aws-lambda";

const serverParams = {
  command: "node",
  args: [
    "/var/task/node_modules/@ivotoby/openapi-mcp-server/bin/mcp-server.js",
    "--api-base-url",
    "https://catfact.ninja",
    "--openapi-spec",
    "./cat-facts-openapi.json",
  ],
};

const requestHandler = new LambdaFunctionURLEventHandler(
  new StdioServerAdapterRequestHandler(serverParams)
);

export const handler: Handler = async (
  event: APIGatewayProxyEventV2WithIAMAuthorizer,
  context: Context
): Promise<APIGatewayProxyResultV2> => {
  // To customize the handler based on the caller's identity, you can use:
  // event.requestContext.authorizer.iam

  return requestHandler.handle(event, context);
};
