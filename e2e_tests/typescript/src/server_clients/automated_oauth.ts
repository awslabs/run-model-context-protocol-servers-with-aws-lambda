import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  OAuthClientProvider,
  discoverOAuthMetadata,
  discoverOAuthProtectedResourceMetadata,
  extractResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Server } from "./server.js";
import logger from "../logger.js";

/**
 * Configuration interface for AutomatedOAuthClient
 */
export interface AutomatedOAuthConfig {
  // Lookup server URL from a CloudFormation stack
  serverStackName: string;
  serverStackUrlOutputKey?: string;
  serverStackRegion?: string;
}

/**
 * Manages MCP server connections and tool execution for streamable HTTP servers requiring automated OAuth authentication.
 *
 * This client handles OAuth using client credentials grant (machine-to-machine authentication) without browser interaction.
 * It automatically looks up all required configuration from CloudFormation stacks and AWS Secrets Manager.
 *
 * Configuration is retrieved from:
 * - Server URL: CloudFormation stack output
 * - Client ID: CloudFormation stack output 'AutomatedOAuthClientId' from 'LambdaMcpServer-Auth' stack
 * - Client Secret: AWS Secrets Manager secret (ARN from CloudFormation stack output 'OAuthClientSecretArn')
 */
export class AutomatedOAuthClient extends Server {
  private oauthProvider?: AutomatedOAuthClientProvider;

  // Lookup server URL from a CloudFormation stack
  private serverStackName: string;
  private serverStackUrlOutputKey: string;
  private serverStackRegion: string;

  // Fixed auth stack configuration
  private readonly authStackName = "LambdaMcpServer-Auth";
  private readonly authStackRegion = "us-east-2";

  constructor(name: string, config: AutomatedOAuthConfig) {
    super(name, config);

    this.serverStackName = config.serverStackName;
    this.serverStackUrlOutputKey =
      config.serverStackUrlOutputKey || "McpServerUrl";
    this.serverStackRegion = config.serverStackRegion || "us-east-2";
  }

  /**
   * Initialize the server connection with automated OAuth authentication.
   * @throws Error if initialization parameters are invalid
   * @throws Error if server fails to initialize
   */
  async initialize(): Promise<void> {
    try {
      // Get server URL from CloudFormation
      logger.debug("Retrieving server URL from CloudFormation...");
      const serverUrl = await this.getServerUrlFromCloudFormation();
      this.config.serverUrl = serverUrl;

      logger.debug(`Connecting to OAuth-protected MCP server: ${serverUrl}`);

      // Discover the required scope from the server
      const scope = await this.discoverScope();

      // Get OAuth client configuration
      logger.debug("Retrieving OAuth client configuration...");
      const clientId = await this.getClientIdFromCloudFormation();
      const clientSecret = await this.getClientSecretFromSecretsManager();

      const clientMetadata: OAuthClientMetadata = {
        client_name: `MCP Client - ${this.name}`,
        redirect_uris: [], // Not used in client credentials flow
        grant_types: ["client_credentials"],
        response_types: [],
        token_endpoint_auth_method: "client_secret_basic",
        scope: scope,
      };

      logger.debug("Creating automated OAuth provider...");
      this.oauthProvider = new AutomatedOAuthClientProvider(
        clientMetadata,
        clientId,
        clientSecret
      );

      logger.debug("Starting automated OAuth flow...");
      await this.attemptConnection();
    } catch (error) {
      logger.error(
        `Error initializing automated OAuth server ${this.name}: ${error}`
      );
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
        (output) => output.OutputKey === "AutomatedOAuthClientId"
      );

      if (!clientIdOutput || !clientIdOutput.OutputValue) {
        throw new Error(
          `AutomatedOAuthClientId output not found in CloudFormation stack '${this.authStackName}'`
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
   * Retrieves the client secret from AWS Secrets Manager
   */
  private async getClientSecretFromSecretsManager(): Promise<string> {
    try {
      // First get the secret ARN from CloudFormation
      logger.debug("Retrieving client secret ARN from CloudFormation...");

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

      const secretArnOutput = stack.Outputs.find(
        (output) => output.OutputKey === "OAuthClientSecretArn"
      );

      if (!secretArnOutput || !secretArnOutput.OutputValue) {
        throw new Error(
          `OAuthClientSecretArn output not found in CloudFormation stack '${this.authStackName}'`
        );
      }

      const secretArn = secretArnOutput.OutputValue;
      logger.debug(`Retrieved secret ARN: ${secretArn}`);

      // Now get the secret value from Secrets Manager
      logger.debug("Retrieving client secret from Secrets Manager...");

      const secretsManagerClient = new SecretsManagerClient({
        region: this.authStackRegion,
      });

      const getSecretCommand = new GetSecretValueCommand({
        SecretId: secretArn,
      });

      const secretResponse = await secretsManagerClient.send(getSecretCommand);

      if (!secretResponse.SecretString) {
        throw new Error("No secret string found in Secrets Manager response");
      }

      logger.debug("Successfully retrieved client secret");
      return secretResponse.SecretString;
    } catch (error) {
      logger.error(`Failed to retrieve client secret:`, error);

      if (error instanceof Error) {
        if (error.name === "ResourceNotFoundException") {
          throw new Error(
            "OAuth client secret not found in Secrets Manager. Ensure the secret exists and the ARN is correct."
          );
        } else if (
          error.name === "AccessDenied" ||
          error.name === "UnauthorizedOperation"
        ) {
          throw new Error(
            "Insufficient permissions to access Secrets Manager. Ensure your AWS credentials have secretsmanager:GetSecretValue permission."
          );
        }
      }

      throw new Error(
        `Could not retrieve OAuth client secret: ${
          error instanceof Error ? error.message : String(error)
        }`
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
      resourceMetadata.authorization_servers &&
      resourceMetadata.authorization_servers.length > 0
    ) {
      this.config.authorizationServerUrl =
        resourceMetadata.authorization_servers[0];
    } else {
      throw new Error(
        "No authorization server found in OAuth protected resource metadata"
      );
    }

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
   * Attempts connection with automated OAuth provider
   */
  private async attemptConnection(): Promise<void> {
    if (!this.oauthProvider) {
      throw new Error("OAuth provider not initialized");
    }

    // Perform client credentials flow directly for machine-to-machine authentication
    await this.performClientCredentialsFlow();

    logger.debug("Creating transport with automated OAuth provider...");
    const baseUrl = new URL(this.config.serverUrl);
    const transport = new StreamableHTTPClientTransport(baseUrl, {
      authProvider: this.oauthProvider,
    });

    logger.debug("Connecting with automated OAuth...");
    await this.client.connect(transport);
    logger.debug("Connected successfully with automated OAuth");
  }

  /**
   * Performs the client credentials OAuth flow to obtain access tokens
   */
  private async performClientCredentialsFlow(): Promise<void> {
    if (!this.oauthProvider) {
      throw new Error("OAuth provider not initialized");
    }

    try {
      // Check if we already have a tokens
      if (this.oauthProvider.tokens()?.access_token) {
        logger.debug("Using existing access token");
        return;
      }

      logger.debug("Performing client credentials flow...");

      // Discover OAuth metadata
      const metadata = await discoverOAuthMetadata(
        this.config.authorizationServerUrl
      );

      if (!metadata?.token_endpoint) {
        throw new Error("No token endpoint found in OAuth metadata");
      }

      const clientInfo = this.oauthProvider.clientInformation();
      if (!clientInfo) {
        throw new Error("No client information available");
      }

      // Perform client credentials token request
      const tokenUrl = new URL(metadata.token_endpoint);
      const params = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientInfo.client_id,
        client_secret: clientInfo.client_secret!,
        scope: this.oauthProvider.clientMetadata.scope || "",
      });

      logger.debug(`Making token request to: ${tokenUrl}`);
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Token request failed: HTTP ${response.status} - ${errorText}`
        );
      }

      const tokenResponse = await response.json();

      logger.debug(
        "Successfully obtained access token via client credentials flow"
      );

      // Save the tokens (saveTokens will automatically track the issued time)
      this.oauthProvider.saveTokens(tokenResponse);
    } catch (error) {
      logger.error("Client credentials flow failed:", error);
      throw error;
    }
  }
}

/**
 * OAuth client provider for automated (client credentials) OAuth flows.
 * This provider handles machine-to-machine authentication without user interaction.
 * For the purposes of the integration tests, this implementation does not
 * refresh tokens and assumes that the intial token will not expire before the test completes.
 */
class AutomatedOAuthClientProvider implements OAuthClientProvider {
  private _clientInformation: OAuthClientInformationFull;
  private _tokens?: OAuthTokens;

  constructor(
    private readonly _clientMetadata: OAuthClientMetadata,
    clientId: string,
    clientSecret: string
  ) {
    this._clientInformation = {
      client_id: clientId,
      client_secret: clientSecret,
      ...this._clientMetadata,
    };
  }

  get redirectUrl(): string | URL {
    // Not used in client credentials flow
    return "";
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
    // Not used in client credentials flow - no user interaction
    throw new Error(
      "redirectToAuthorization should not be called in automated OAuth flow"
    );
  }

  saveCodeVerifier(codeVerifier: string): void {
    // Not used in client credentials flow
    throw new Error(
      "saveCodeVerifier should not be called in automated OAuth flow"
    );
  }

  codeVerifier(): string {
    // Not used in client credentials flow
    throw new Error(
      "codeVerifier should not be called in automated OAuth flow"
    );
  }
}
