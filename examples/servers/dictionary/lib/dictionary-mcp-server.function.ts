import { Handler, Context } from "aws-lambda";
import {
  BedrockAgentCoreGatewayTargetHandler,
  StdioServerAdapterRequestHandler,
} from "@aws/run-mcp-servers-with-aws-lambda";

const serverParams = {
  command: "node",
  args: [
    "/var/task/node_modules/@ivotoby/openapi-mcp-server/bin/mcp-server.js",
    "--api-base-url",
    "https://en.wiktionary.org/api/rest_v1",
    "--openapi-spec",
    "./wiktionary-openapi.json",
    // Wikimedia APIs require a descriptive User-Agent header:
    // https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy
    "--headers",
    "User-Agent:run-mcp-servers-with-aws-lambda-dictionary-example/1.0 (https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda)",
  ],
};

const requestHandler = new BedrockAgentCoreGatewayTargetHandler(
  new StdioServerAdapterRequestHandler(serverParams)
);

export const handler: Handler = async (
  event: Record<string, unknown>,
  context: Context
): Promise<unknown> => {
  return requestHandler.handle(event, context);
};
