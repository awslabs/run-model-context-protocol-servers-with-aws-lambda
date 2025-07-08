import { createServer } from "node:http";
import { URL } from "node:url";
import { exec } from "node:child_process";
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  OAuthClientProvider,
  UnauthorizedError,
  discoverOAuthProtectedResourceMetadata,
  extractResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Server } from "./server.js";
import logger from "../logger.js";

/**
 * Configuration interface for InteractiveOAuthClient
 */
export interface InteractiveOAuthConfig {
  // Manually configure server URL
  serverUrl?: string;

  // Lookup server URL from a CloudFormation stack
  serverStackName?: string;
  serverStackUrlOutputKey?: string;
  serverStackRegion?: string;

  // Lookup OAuth client ID from a CloudFormation stack (defaults to true)
  lookupClientIdFromCloudFormation?: boolean;
  authStackName?: string;
  authStackClientIdOutputKey?: string;
  authStackRegion?: string;
}

/**
 * Manages MCP server connections and tool execution for streamable HTTP servers requiring interactive OAuth authentication.
 *
 * This client handles the complete OAuth flow including browser-based authorization.
 *
 * Since API Gateway creates a new, unique endpoint for each gateway, this
 * client can lookup the gateway URL from a CloudFormation stack output instead of requiring
 * the user to statically configure the server URL.
 *
 * The example OAuth-enabled MCP servers in this repo all require distributing an OAuth client ID
 * to the clients, and do not support dynamic client registration. By default, this client will
 * look up the client ID from a CloudFormation stack output to simplify configuration for the
 * example chatbot.
 */
export class InteractiveOAuthClient extends Server {
  private oauthProvider?: InMemoryOAuthClientProvider;
  private callbackPort: number;
  private callbackUrl: string;

  // Lookup server URL from a CloudFormation stack
  private serverStackName: string;
  private serverStackUrlOutputKey: string;
  private serverStackRegion: string;

  // Lookup OAuth client ID from a CloudFormation stack
  private lookupClientIdFromCloudFormation: boolean;
  private authStackName: string;
  private authStackClientIdOutputKey: string;
  private authStackRegion: string;

  constructor(name: string, config: InteractiveOAuthConfig) {
    super(name, config);

    if (!config.serverUrl && !config.serverStackName) {
      throw new Error(
        "Either serverUrl must be provided or serverStackName must be provided for CloudFormation lookup"
      );
    }

    if (config.serverUrl && config.serverStackName) {
      throw new Error(
        "Only one of serverUrl or serverStackName can be provided"
      );
    }

    this.callbackPort = 8090;
    this.callbackUrl = `http://localhost:${this.callbackPort}/callback`;

    this.serverStackName = config.serverStackName || "";
    this.serverStackUrlOutputKey =
      config.serverStackUrlOutputKey || "McpServerUrl";
    this.serverStackRegion = config.serverStackRegion || "us-east-2";

    this.lookupClientIdFromCloudFormation =
      config.lookupClientIdFromCloudFormation ?? true;
    this.authStackName = config.authStackName || "LambdaMcpServer-Auth";
    this.authStackClientIdOutputKey =
      config.authStackClientIdOutputKey || "InteractiveOAuthClientId";
    this.authStackRegion = config.authStackRegion || "us-east-2";
  }

  /**
   * Initialize the server connection with OAuth authentication.
   * @throws Error if initialization parameters are invalid
   * @throws Error if server fails to initialize
   */
  async initialize(): Promise<void> {
    try {
      // Determine the server URL
      let serverUrl = this.config.serverUrl;
      if (this.serverStackName) {
        logger.debug("Retrieving server URL from CloudFormation...");
        serverUrl = await this.getServerUrlFromCloudFormation();
        // Update the config with the resolved URL
        this.config.serverUrl = serverUrl;
      }

      if (!serverUrl) {
        throw new Error(
          "The serverUrl must be a valid string and cannot be undefined."
        );
      }

      logger.debug(`Connecting to OAuth-protected MCP server: ${serverUrl}`);

      // Discover the required scope from the server
      const scope = await this.discoverScope();

      const clientMetadata: OAuthClientMetadata = {
        client_name: `MCP Client - ${this.name}`,
        redirect_uris: [this.callbackUrl],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none", // No client secret for example servers when in interactive flow
        scope: scope,
      };

      let clientId = undefined;
      if (this.lookupClientIdFromCloudFormation) {
        logger.debug("Retrieving OAuth client ID from CloudFormation...");
        clientId = await this.getClientIdFromCloudFormation();
      }

      logger.debug("Creating OAuth provider...");
      this.oauthProvider = new InMemoryOAuthClientProvider(
        this.callbackUrl,
        clientMetadata,
        clientId,
        undefined, // No client secret for example servers when in interactive flow
        (redirectUrl: URL) => {
          logger.debug(`OAuth redirect handler called - opening browser`);
          this.openBrowser(redirectUrl.toString());
        }
      );

      logger.debug("Starting OAuth flow...");
      await this.attemptConnection(this.oauthProvider);
    } catch (error) {
      logger.error(`Error initializing OAuth server ${this.name}: ${error}`);
      throw error;
    }
  }

  /**
   * Retrieves the OAuth client ID from CloudFormation stack outputs
   */
  private async getClientIdFromCloudFormation(): Promise<string> {
    try {
      logger.debug(
        `Retrieving client ID from CloudFormation stack: ${this.authStackName}`
      );

      const cloudFormationClient = new CloudFormationClient({
        region: this.authStackRegion,
      });

      const command = new DescribeStacksCommand({
        StackName: this.authStackName,
      });

      const response = await cloudFormationClient.send(command);

      if (!response.Stacks || response.Stacks.length === 0) {
        throw new Error(
          `CloudFormation stack '${this.authStackName}' not found`
        );
      }

      const stack = response.Stacks[0];
      if (!stack.Outputs) {
        throw new Error(
          `No outputs found in CloudFormation stack '${this.authStackName}'`
        );
      }

      const clientIdOutput = stack.Outputs.find(
        (output) => output.OutputKey === this.authStackClientIdOutputKey
      );

      if (!clientIdOutput || !clientIdOutput.OutputValue) {
        throw new Error(
          `Client ID output not found in CloudFormation stack. Output key: ${this.authStackClientIdOutputKey}`
        );
      }

      const clientId = clientIdOutput.OutputValue;
      logger.debug(`Retrieved client ID: ${clientId}`);
      return clientId;
    } catch (error) {
      logger.error(`Failed to retrieve client ID from CloudFormation:`, error);

      if (error instanceof Error) {
        if (error.name === "ValidationException") {
          throw new Error(
            `CloudFormation stack '${this.authStackName}' does not exist or is not accessible`
          );
        } else if (
          error.name === "AccessDenied" ||
          error.name === "UnauthorizedOperation"
        ) {
          throw new Error(
            `Insufficient permissions to access CloudFormation stack '${this.authStackName}'. Ensure your AWS credentials have cloudformation:DescribeStacks permission.`
          );
        }
      }

      throw new Error(
        `Could not retrieve OAuth client ID from CloudFormation stack ${
          this.authStackName
        }: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Retrieves the server URL from CloudFormation stack outputs
   */
  private async getServerUrlFromCloudFormation(): Promise<string> {
    try {
      logger.debug(
        `Retrieving server URL from CloudFormation stack: ${this.serverStackName}`
      );

      const cloudFormationClient = new CloudFormationClient({
        region: this.serverStackRegion,
      });

      const command = new DescribeStacksCommand({
        StackName: this.serverStackName,
      });

      const response = await cloudFormationClient.send(command);

      if (!response.Stacks || response.Stacks.length === 0) {
        throw new Error(
          `CloudFormation stack '${this.serverStackName}' not found`
        );
      }

      const stack = response.Stacks[0];
      if (!stack.Outputs) {
        throw new Error(
          `No outputs found in CloudFormation stack '${this.serverStackName}'`
        );
      }

      const serverUrlOutput = stack.Outputs.find(
        (output) => output.OutputKey === this.serverStackUrlOutputKey
      );

      if (!serverUrlOutput || !serverUrlOutput.OutputValue) {
        throw new Error(
          `Server URL output not found in CloudFormation stack. Output key: ${this.serverStackUrlOutputKey}`
        );
      }

      const serverUrl = serverUrlOutput.OutputValue;
      logger.debug(`Retrieved server URL: ${serverUrl}`);
      return serverUrl;
    } catch (error) {
      logger.error(`Failed to retrieve server URL from CloudFormation:`, error);

      if (error instanceof Error) {
        if (error.name === "ValidationException") {
          throw new Error(
            `CloudFormation stack '${this.serverStackName}' does not exist or is not accessible`
          );
        } else if (
          error.name === "AccessDenied" ||
          error.name === "UnauthorizedOperation"
        ) {
          throw new Error(
            `Insufficient permissions to access CloudFormation stack '${this.serverStackName}'. Ensure your AWS credentials have cloudformation:DescribeStacks permission.`
          );
        }
      }

      throw new Error(
        `Could not retrieve server URL from CloudFormation stack ${
          this.serverStackName
        }: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Opens the authorization URL in the user's default browser
   */
  private async openBrowser(url: string): Promise<void> {
    logger.debug(`Opening browser for authorization: ${url}`);

    const command = `open "${url}"`;

    exec(command, (error) => {
      if (error) {
        logger.error(`Failed to open browser: ${error.message}`);
        logger.info(`Please manually open: ${url}`);
      }
    });
  }

  /**
   * Starts a temporary HTTP server to receive the OAuth callback
   */
  private async waitForOAuthCallback(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        // Ignore favicon requests
        if (req.url === "/favicon.ico") {
          res.writeHead(404);
          res.end();
          return;
        }

        logger.debug(`Received OAuth callback: ${req.url}`);
        const parsedUrl = new URL(req.url || "", "http://localhost");
        const code = parsedUrl.searchParams.get("code");
        const error = parsedUrl.searchParams.get("error");

        if (code) {
          logger.debug(
            `Authorization code received: ${code?.substring(0, 10)}...`
          );
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body>
                <h1>Authorization Successful!</h1>
                <p>You can close this window and return to the application.</p>
                <script>setTimeout(() => window.close(), 2000);</script>
              </body>
            </html>
          `);

          resolve(code);
          setTimeout(() => server.close(), 3000);
        } else if (error) {
          logger.error(`Authorization error: ${error}`);
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body>
                <h1>Authorization Failed</h1>
                <p>Error: ${error}</p>
              </body>
            </html>
          `);
          reject(new Error(`OAuth authorization failed: ${error}`));
        } else {
          logger.error(`No authorization code or error in callback`);
          res.writeHead(400);
          res.end("Bad request");
          reject(new Error("No authorization code provided"));
        }
      });

      server.listen(this.callbackPort, () => {
        logger.debug(
          `OAuth callback server started on http://localhost:${this.callbackPort}`
        );
      });
    });
  }

  /**
   * Discovers the required scope from OAuth protected resource metadata
   */
  private async discoverScope(): Promise<string> {
    logger.debug("Making initial request to discover OAuth metadata...");

    const serverUrl = this.config.serverUrl;
    const response = await fetch(serverUrl);
    const resourceMetadataUrl = extractResourceMetadataUrl(response);

    if (!resourceMetadataUrl) {
      throw new Error(
        "No resource metadata URL found in WWW-Authenticate header"
      );
    }

    logger.debug(`Discovered resource metadata URL: ${resourceMetadataUrl}`);
    logger.debug("Fetching OAuth protected resource metadata...");

    const resourceMetadata = await discoverOAuthProtectedResourceMetadata(
      serverUrl,
      { resourceMetadataUrl }
    );

    if (
      !resourceMetadata.scopes_supported ||
      resourceMetadata.scopes_supported.length === 0
    ) {
      throw new Error("No scopes found in OAuth protected resource metadata");
    }

    const discoveredScope = resourceMetadata.scopes_supported.join(" ");
    logger.debug(`Discovered scope from server metadata: ${discoveredScope}`);
    return discoveredScope;
  }

  /**
   * Attempts connection with OAuth provider, handling the authorization flow
   */
  private async attemptConnection(
    oauthProvider: InMemoryOAuthClientProvider
  ): Promise<void> {
    logger.debug("Creating transport with OAuth provider...");
    const baseUrl = new URL(this.config.serverUrl);
    const transport = new StreamableHTTPClientTransport(baseUrl, {
      authProvider: oauthProvider,
    });

    try {
      logger.debug(
        "Attempting connection (this will trigger OAuth redirect if needed)..."
      );
      await this.client.connect(transport);
      logger.debug("Connected successfully");
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        logger.debug("OAuth required - waiting for authorization...");
        const callbackPromise = this.waitForOAuthCallback();
        const authCode = await callbackPromise;
        await transport.finishAuth(authCode);
        logger.debug("Authorization completed successfully");
        logger.debug("Reconnecting with authenticated transport...");
        await this.attemptConnection(oauthProvider);
      } else {
        logger.error("Connection failed with non-auth error:", error);
        throw error;
      }
    }
  }
}

/**
 * In-memory OAuth client provider for interactive OAuth flows.
 * In production, you should persist tokens securely. However, for
 * the demo chatbot, it's ok to ask the user to re-authenticate
 * in the browser each time they run the demo.
 */
class InMemoryOAuthClientProvider implements OAuthClientProvider {
  private _clientInformation?: OAuthClientInformationFull;
  private _tokens?: OAuthTokens;
  private _codeVerifier?: string;

  constructor(
    private readonly _redirectUrl: string | URL,
    private readonly _clientMetadata: OAuthClientMetadata,
    private readonly _clientId?: string,
    private readonly _clientSecret?: string,
    onRedirect?: (url: URL) => void
  ) {
    this._onRedirect =
      onRedirect ||
      ((url) => {
        console.log(`Redirect to: ${url.toString()}`);
      });

    // Fill in OAuth client ID and client secret if provided
    if (this._clientId) {
      this._clientInformation = {
        client_id: this._clientId,
        client_secret: this._clientSecret,
        ...this._clientMetadata,
      };
    }
  }

  private _onRedirect: (url: URL) => void;

  get redirectUrl(): string | URL {
    return this._redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this._clientMetadata;
  }

  clientInformation(): OAuthClientInformation | undefined {
    return this._clientInformation;
  }

  saveClientInformation(clientInformation: OAuthClientInformationFull): void {
    this._clientInformation = clientInformation;
  }

  tokens(): OAuthTokens | undefined {
    return this._tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this._tokens = tokens;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this._onRedirect(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string): void {
    this._codeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this._codeVerifier) {
      throw new Error("No code verifier saved");
    }
    return this._codeVerifier;
  }
}
