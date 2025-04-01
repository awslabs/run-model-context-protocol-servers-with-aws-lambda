import { Handler, Context } from "aws-lambda";

const serverParams = {
  command: "npx",
  args: ["--offline", "openapi-mcp-server", "./weather-alerts-openapi.json"],
};

export const handler: Handler = async (event, context: Context) => {
  // Dynamically import ES module into CommonJS Lambda function
  const { stdioServerAdapter } = await import("mcp-server-in-aws-lambda");

  return await stdioServerAdapter(serverParams, event, context);
};
