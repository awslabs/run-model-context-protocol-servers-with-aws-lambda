import { Handler, Context } from "aws-lambda";

const serverParams = {
  command: "npx",
  args: ["--offline", "openapi-mcp-server", "./cat-facts-openapi.json"],
};

export const handler: Handler = async (event, context: Context) => {
  // Dynamically import ES module into CommonJS Lambda function
  const { stdioServerAdapter } = await import(
    "@aws/run-mcp-servers-with-aws-lambda"
  );

  return await stdioServerAdapter(serverParams, event, context);
};
