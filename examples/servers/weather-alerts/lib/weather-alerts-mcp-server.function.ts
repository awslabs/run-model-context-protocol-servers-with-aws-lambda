import { Handler, Context } from "aws-lambda";

const serverParams = {
  command: "node",
  args: [
    "/var/task/node_modules/@ivotoby/openapi-mcp-server/bin/mcp-server.js",
    "--api-base-url",
    "https://api.weather.gov",
    "--openapi-spec",
    "./weather-alerts-openapi.json",
  ],
};

export const handler: Handler = async (event, context: Context) => {
  // Dynamically import ES module into CommonJS Lambda function
  const { stdioServerAdapter } = await import(
    "@aws/run-mcp-servers-with-aws-lambda"
  );

  return await stdioServerAdapter(serverParams, event, context);
};
