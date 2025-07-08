import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

interface CognitoConfiguration {
  [key: string]: any;
}

interface OAuthServerMetadata {
  [key: string]: any;
  code_challenge_methods_supported?: string[];
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const cognitoConfigUrl = process.env.COGNITO_OPENID_CONFIG_URL;

  if (!cognitoConfigUrl) {
    console.error("COGNITO_OPENID_CONFIG_URL environment variable not set");
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: "Configuration error" }),
    };
  }

  try {
    // Fetch Cognito's OpenID configuration
    const cognitoConfig = await fetchJson(cognitoConfigUrl);

    // Add the missing code_challenge_methods_supported field
    const modifiedConfig: OAuthServerMetadata = {
      ...cognitoConfig,
      code_challenge_methods_supported: ["S256"],
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600", // Cache for 1 hour
      },
      body: JSON.stringify(modifiedConfig, null, 2),
    };
  } catch (error) {
    console.error("Error fetching Cognito config:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: "Failed to fetch OAuth configuration" }),
    };
  }
};

async function fetchJson(url: string): Promise<CognitoConfiguration> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "MCP-OAuth-Proxy/1.0",
    },
    // Add timeout using AbortController
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return await response.json();
}
