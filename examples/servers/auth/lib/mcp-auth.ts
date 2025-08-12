import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  UserPool,
  OAuthScope,
  ResourceServerScope,
  UserPoolResourceServer,
  CfnUserPoolUser,
} from "aws-cdk-lib/aws-cognito";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import {
  RestApi,
  Cors,
  MockIntegration,
  AuthorizationType,
  DomainName,
  BasePathMapping,
  PassthroughBehavior,
} from "aws-cdk-lib/aws-apigateway";
import { HostedZone } from "aws-cdk-lib/aws-route53";
import { ARecord, RecordTarget } from "aws-cdk-lib/aws-route53";
import { ApiGatewayDomain } from "aws-cdk-lib/aws-route53-targets";
import {
  Certificate,
  CertificateValidation,
} from "aws-cdk-lib/aws-certificatemanager";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";

interface McpAuthStackProps extends cdk.StackProps {
  hostedZoneDomainName: string;
}

interface CognitoResources {
  userPool: UserPool;
  userCredentialsSecret: Secret;
  oauthScopes: OAuthScope[];
  interactiveClient: cdk.aws_cognito.UserPoolClient;
  automatedClient: cdk.aws_cognito.UserPoolClient;
  automatedClientSecret: Secret;
}

export class McpAuthStack extends cdk.Stack {
  private userPoolDomain: any;
  private hostedZoneDomainName: string;

  constructor(scope: Construct, id: string, props: McpAuthStackProps) {
    super(scope, id, props);

    this.hostedZoneDomainName = props.hostedZoneDomainName;

    // Create Cognito resources
    const cognitoResources = this.createCognitoResources();

    // OAuth endpoint at a custom sub-domain that re-directs to Cognito.
    //
    // This is necessary because MCP clients currently require that the OAuth authorization server
    // serves metadata discovery at the path /.well-known/oauth-authorization-server.
    // However, Cognito only serves /.well-known/openid-configuration.
    // See https://github.com/modelcontextprotocol/typescript-sdk/issues/616
    //
    // This endpoint proxies Cognito's endpoint and adds metadata keys expected by
    // MCP clients that Cognito does not provide like code_challenge_methods_supported.
    this.createOAuthDiscoveryEndpoint(cognitoResources.userPool);
  }

  private createCognitoResources(): CognitoResources {
    // Create Cognito User Pool
    const userPool = new UserPool(this, "McpAuthUserPool", {
      userPoolName: `mcp-lambda-examples`,
      selfSignUpEnabled: false,
      signInAliases: {
        email: true,
        username: true,
      },
      autoVerify: {
        email: true,
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cdk.aws_cognito.AccountRecovery.NONE,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      standardThreatProtectionMode:
        cdk.aws_cognito.StandardThreatProtectionMode.FULL_FUNCTION,
      featurePlan: cdk.aws_cognito.FeaturePlan.PLUS,
    });

    // Create a user in the user pool
    new CfnUserPoolUser(this, "McpAuthUser", {
      userPoolId: userPool.userPoolId,
      username: "mcp-user",
      userAttributes: [
        {
          name: "email",
          value: "mcp-user@example.com",
        },
        {
          name: "email_verified",
          value: "true",
        },
      ],
      messageAction: "SUPPRESS",
    });

    const userCredentialsSecret = new Secret(this, "McpUserPassword", {
      secretName: `mcp-lambda-examples-user-creds`,
      description: "Credentials for MCP user",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "mcp-user" }),
        generateStringKey: "password",
        excludeCharacters: '"@/\\',
        includeSpace: false,
        passwordLength: 16,
        requireEachIncludedType: true,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    NagSuppressions.addResourceSuppressions(userCredentialsSecret, [
      {
        id: "AwsSolutions-SMG4",
        reason:
          "Credentials will not be automatically rotated for this example.",
      },
    ]);

    // Create User Pool Domain
    this.userPoolDomain = userPool.addDomain("McpAuthUserPoolDomain", {
      cognitoDomain: {
        domainPrefix: `mcp-lambda-examples-${this.account}`,
      },
    });

    // Scope for each MCP server that will use this user pool.
    // The scopes will be 'mcp-resource-server/dad-jokes' and 'mcp-resource-server/dog-facts'.
    // You can also create a resource server per MCP server,
    // and do something like 'dad-jokes/tools' and 'dog-facts/tools' for the scopes.
    const mcpServers = ["dad-jokes", "dog-facts"];
    const resourceServerScopes = mcpServers.map(
      (mcpServer) =>
        new ResourceServerScope({
          scopeName: mcpServer,
          scopeDescription: `Scope for ${mcpServer} MCP server`,
        })
    );
    const resourceServer = new UserPoolResourceServer(this, "ResourceServer", {
      identifier: "mcp-resource-server",
      userPool: userPool,
      scopes: resourceServerScopes,
    });
    const oauthScopes = resourceServerScopes.map((scope) =>
      OAuthScope.resourceServer(resourceServer, scope)
    );

    // OAuth client for interactive chatbots:
    // The client will redirect users to the browser for sign-in
    const interactiveClient = userPool.addClient("InteractiveClient", {
      generateSecret: false,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(60),
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: oauthScopes,
        callbackUrls: [
          "http://localhost:9876/callback", // Local testing with oauth2c
          "http://localhost:6274/oauth/callback", // Local testing with MCP inspector
          "http://localhost:8090/callback", // Local example chatbot
        ],
      },
      authFlows: {
        userPassword: true,
      },
    });

    // OAuth client for automated integration tests:
    // The client will provide a client secret for the access token
    const automatedClient = userPool.addClient("AutomatedClient", {
      generateSecret: true,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(60),
      oAuth: {
        flows: {
          clientCredentials: true,
        },
        scopes: oauthScopes,
      },
      authFlows: {},
    });

    const automatedClientSecret = new Secret(this, "AutomatedClientSecret", {
      secretName: `mcp-lambda-examples-oauth-client-secret`,
      description: "Client secret for automated MCP client",
      secretStringValue: automatedClient.userPoolClientSecret,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    NagSuppressions.addResourceSuppressions(automatedClientSecret, [
      {
        id: "AwsSolutions-SMG4",
        reason:
          "OAuth client secret will not be automatically rotated for this example",
      },
    ]);

    // Cognito-related outputs
    new cdk.CfnOutput(this, "UserPoolId", {
      value: userPool.userPoolId,
      description: "Cognito User Pool ID",
      exportName: "McpAuth-UserPoolId",
    });

    new cdk.CfnOutput(this, "IssuerDomain", {
      value: userPool.userPoolProviderUrl,
      description: "Cognito User Pool Issuer URL",
      exportName: "McpAuth-IssuerDomain",
    });

    new cdk.CfnOutput(this, "UserPoolDomain", {
      value: this.userPoolDomain.domainName,
      description: "Cognito User Pool Domain URL",
      exportName: "McpAuth-UserPoolDomain",
    });

    new cdk.CfnOutput(this, "InteractiveOAuthClientId", {
      value: interactiveClient.userPoolClientId,
      description: "Client ID for interactive OAuth flow",
      exportName: "McpAuth-InteractiveClientId",
    });

    new cdk.CfnOutput(this, "AutomatedOAuthClientId", {
      value: automatedClient.userPoolClientId,
      description: "Client ID for automated OAuth flow",
      exportName: "McpAuth-AutomatedClientId",
    });

    new cdk.CfnOutput(this, "OAuthClientSecretArn", {
      value: automatedClientSecret.secretArn,
      description: "ARN of the secret containing the OAuth client secret",
      exportName: "McpAuth-ClientSecretArn",
    });

    new cdk.CfnOutput(this, "UserCredentialsSecretArn", {
      value: userCredentialsSecret.secretArn,
      description:
        "ARN of the secret containing the login credentials for mcp-user",
      exportName: "McpAuth-UserCredentialsArn",
    });

    return {
      userPool,
      userCredentialsSecret,
      oauthScopes,
      interactiveClient,
      automatedClient,
      automatedClientSecret,
    };
  }

  private createOAuthDiscoveryEndpoint(userPool: UserPool) {
    // Create custom domain for API Gateway
    const hostedZone = HostedZone.fromLookup(this, "HostedZone", {
      domainName: this.hostedZoneDomainName,
    });

    const domainName = `mcp-auth.${this.hostedZoneDomainName}`;

    const certificate = new Certificate(this, "Certificate", {
      domainName: domainName,
      validation: CertificateValidation.fromDns(hostedZone),
    });

    const customDomain = new DomainName(this, "CustomAuthDomain", {
      domainName: domainName,
      certificate: certificate,
    });

    new ARecord(this, "AliasRecord", {
      zone: hostedZone,
      recordName: "mcp-auth",
      target: RecordTarget.fromAlias(new ApiGatewayDomain(customDomain)),
    });

    // Create API Gateway with MOCK integration for redirect
    const api = new RestApi(this, "OAuthApiGateway", {
      restApiName: `OAuth endpoint for MCP Auth`,
      description: "OAuth APIs for MCP Auth, behind a custom domain",
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
      },
      deployOptions: {
        stageName: "prod",
        throttlingRateLimit: 1,
        throttlingBurstLimit: 5,
      },
      deploy: true,
      cloudWatchRole: false,
    });

    // Map the custom domain to the API Gateway
    new BasePathMapping(this, "BasePathMapping", {
      domainName: customDomain,
      restApi: api,
      stage: api.deploymentStage,
    });

    // Redirect OAuth discovery endpoint to Cognito's OpenID configuration
    const wellKnownResource = api.root.addResource(".well-known");
    const oauthServerResource = wellKnownResource.addResource(
      "oauth-authorization-server"
    );

    oauthServerResource.addMethod("GET", new MockIntegration({
      passthroughBehavior: PassthroughBehavior.NEVER,
      requestTemplates: {
        "application/json": '{"statusCode": 302}',
      },
      integrationResponses: [
        {
          statusCode: "302",
          responseParameters: {
            "method.response.header.Location": `'${userPool.userPoolProviderUrl}/.well-known/openid-configuration'`,
            "method.response.header.Access-Control-Allow-Origin": "'*'",
          },
        },
      ],
    }), {
      authorizationType: AuthorizationType.NONE,
      methodResponses: [
        {
          statusCode: "302",
          responseParameters: {
            "method.response.header.Location": true,
            "method.response.header.Access-Control-Allow-Origin": true,
          },
        },
      ],
    });

    // Stack outputs
    new cdk.CfnOutput(this, "AuthorizationServerUrl", {
      value: `https://${domainName}/`,
      description: "OAuth URL",
      exportName: "McpAuth-AuthorizationServerUrl",
    });
  }
}

const app = new cdk.App();
const stack = new McpAuthStack(app, "LambdaMcpServer-Auth", {
  env: { account: process.env["CDK_DEFAULT_ACCOUNT"], region: "us-east-2" },
  stackName: "LambdaMcpServer-Auth",
  hostedZoneDomainName: "liguori.people.aws.dev",
});

// Add CDK NAG suppressions for the entire stack
NagSuppressions.addStackSuppressions(stack, [
  {
    id: "AwsSolutions-IAM4",
    reason:
      "AWS managed policies are acceptable for CDK custom resource Lambda functions (created to retrieve OAuth client secret)",
    appliesTo: [
      "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
    ],
  },
]);

cdk.Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }));
app.synth();
