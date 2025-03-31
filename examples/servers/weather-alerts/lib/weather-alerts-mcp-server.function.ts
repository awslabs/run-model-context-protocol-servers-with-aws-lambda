import { Handler, Context } from "aws-lambda";

const serverParams = {
  command: "npx",
  args: ["--offline", "openapi-mcp-server", "./weather-alerts-openapi.json"],
};

export const handler: Handler = async (event, context: Context) => {
  const { stdioServerAdapter } = await import("mcp-lambda");
  return await stdioServerAdapter(serverParams, event, context);
};
