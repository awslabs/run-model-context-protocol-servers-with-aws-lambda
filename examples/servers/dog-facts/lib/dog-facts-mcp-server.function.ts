import {
  Handler,
  Context,
  APIGatewayProxyWithCognitoAuthorizerEvent,
  APIGatewayProxyResult,
} from "aws-lambda";
import {
  APIGatewayProxyEventHandler,
  StdioServerAdapterRequestHandler,
} from "@aws/run-mcp-servers-with-aws-lambda";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

let cachedApiKey: string | null = null;

async function getApiKey(): Promise<string> {
  if (cachedApiKey) {
    return cachedApiKey;
  }

  const secretArn = process.env.DOG_API_KEY_SECRET_ARN;
  if (!secretArn) {
    throw new Error("DOG_API_KEY_SECRET_ARN environment variable not set");
  }

  const client = new SecretsManagerClient({});
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

  if (!response.SecretString) {
    throw new Error("Secret value not found");
  }

  cachedApiKey = response.SecretString;
  return cachedApiKey!;
}

let requestHandler: APIGatewayProxyEventHandler | null = null;

async function initializeHandler(): Promise<APIGatewayProxyEventHandler> {
  if (requestHandler) {
    return requestHandler;
  }

  const apiKey = await getApiKey();
  const serverParams = {
    command: "node",
    args: [
      "/var/task/node_modules/@ivotoby/openapi-mcp-server/bin/mcp-server.js",
      "--api-base-url",
      "https://api.thedogapi.com/v1",
      "--openapi-spec",
      "./dog-facts-openapi.json",
      "--headers",
      `x-api-key:${apiKey}`,
    ],
  };

  requestHandler = new APIGatewayProxyEventHandler(
    new StdioServerAdapterRequestHandler(serverParams)
  );

  return requestHandler;
}

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  // To customize the handler based on the caller's identity, you can use properties like:
  // event.requestContext.authorizer.claims["cognito:username"]

  const handler = await initializeHandler();
  return handler.handle(event, context);
};
