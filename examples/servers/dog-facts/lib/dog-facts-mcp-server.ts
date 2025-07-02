import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { Code, LayerVersion, Runtime } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Role } from "aws-cdk-lib/aws-iam";
import {
  RestApi,
  LambdaIntegration,
  CognitoUserPoolsAuthorizer,
  AuthorizationType,
  Cors,
  GatewayResponse,
  ResponseType,
  MockIntegration,
} from "aws-cdk-lib/aws-apigateway";
import { UserPool } from "aws-cdk-lib/aws-cognito";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import * as path from "path";

export class DogFactsMcpServer extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    stackNameSuffix: string,
    props?: cdk.StackProps
  ) {
    super(scope, id, props);

    // For testing, the @aws/run-mcp-servers-with-aws-lambda package is bundled from local files.
    // Remove this layer if using the @aws/run-mcp-servers-with-aws-lambda package from npm.
    const mcpLambdaLayer = new LayerVersion(this, "McpLambdaLayer", {
      code: Code.fromAsset(path.join(__dirname, "../../../../src/typescript"), {
        bundling: {
          image: Runtime.NODEJS_22_X.bundlingImage,
          command: [
            "bash",
            "-c",
            [
              "mkdir -p /asset-output/nodejs/node_modules/@aws/run-mcp-servers-with-aws-lambda",
              `cp -r /asset-input/* /asset-output/nodejs/node_modules/@aws/run-mcp-servers-with-aws-lambda/`,
            ].join(" && "),
          ],
        },
      }),
      compatibleRuntimes: [Runtime.NODEJS_22_X],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const logGroup = new LogGroup(this, "LogGroup", {
      logGroupName: "mcp-server-dog-facts" + stackNameSuffix,
      retention: RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const lambdaFunction = new NodejsFunction(this, "function", {
      functionName: "mcp-server-dog-facts" + stackNameSuffix,
      role: Role.fromRoleName(this, "role", "mcp-lambda-example-servers"),
      logGroup,
      memorySize: 2048,
      runtime: Runtime.NODEJS_22_X,
      environment: {
        LOG_LEVEL: "DEBUG",
      },
      layers: [mcpLambdaLayer],
      bundling: {
        format: OutputFormat.ESM,
        mainFields: ["module", "main"],
        nodeModules: ["@ivotoby/openapi-mcp-server"],
        // For testing, the @aws/run-mcp-servers-with-aws-lambda package is bundled from local files using the Lambda layer above.
        // Remove the layer and this externalModules configuration if using the @aws/run-mcp-servers-with-aws-lambda package from npm.
        externalModules: ["@aws/run-mcp-servers-with-aws-lambda"],
        commandHooks: {
          beforeBundling(inputDir: string, outputDir: string): string[] {
            return [];
          },
          afterBundling(inputDir: string, outputDir: string): string[] {
            return [`cp ${inputDir}/dog-facts-openapi.json ${outputDir}/`];
          },
          beforeInstall(inputDir: string, outputDir: string) {
            return [];
          },
        },
      },
    });

    // Create API Gateway for OAuth-based access
    this.createApiGateway(lambdaFunction, stackNameSuffix);
  }

  private createApiGateway(
    lambdaFunction: NodejsFunction,
    stackNameSuffix: string
  ) {
    // This API Gateway will have two paths:
    // 1. /prod/mcp where the MCP server will be served
    // 2. /prod/.well-known/oauth-protected-resource/mcp
    // Typically, you would set up a custom domain for the API Gateway prod deployment stage,
    // such that you would give a URL like https://dog-facts.example.com/mcp to your consumers.

    // Create Lambda integration
    const lambdaIntegration = new LambdaIntegration(lambdaFunction);

    // Authorize with Cognito
    const userPoolId = cdk.Fn.importValue("McpAuth-UserPoolId");
    const authorizationUrl = cdk.Fn.importValue(
      "McpAuth-AuthorizationServerUrl"
    );
    const userPool = UserPool.fromUserPoolId(
      this,
      "ImportedUserPool",
      userPoolId
    );

    const cognitoAuthorizer = new CognitoUserPoolsAuthorizer(
      this,
      "CognitoAuthorizer",
      {
        cognitoUserPools: [userPool],
        identitySource: "method.request.header.Authorization",
        authorizerName: "DogFactsCognitoAuthorizer",
      }
    );

    // Create API Gateway
    const api = new RestApi(this, "DogFactsApiGateway", {
      restApiName: `MCP Dog Facts API Gateway ${stackNameSuffix}`,
      description:
        "API Gateway for MCP Dog Facts server with Cognito authorization",
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
      },
      deployOptions: {
        stageName: "prod",
        throttlingRateLimit: 10,
        throttlingBurstLimit: 20,
      },
      deploy: true,
      cloudWatchRole: false, // no logging for this example
    });

    // Configure gateway responses for proper WWW-Authenticate headers to be RFC 9728 compliant
    // The MCP client SDK uses the 'resource_metadata' value to discover the Cognito authorization server
    new GatewayResponse(this, "UnauthorizedResponse", {
      restApi: api,
      type: ResponseType.UNAUTHORIZED,
      statusCode: "401",
      responseHeaders: {
        "WWW-Authenticate": `'Bearer error="invalid_request", error_description="No access token was provided in this request", resource_metadata="https://${api.restApiId}.execute-api.${this.region}.amazonaws.com/prod/.well-known/oauth-protected-resource/mcp"'`,
      },
    });

    new GatewayResponse(this, "AccessDeniedResponse", {
      restApi: api,
      type: ResponseType.ACCESS_DENIED,
      statusCode: "403",
      responseHeaders: {
        "WWW-Authenticate": `'Bearer error="insufficient_scope"'`,
      },
    });

    // Add mcp endpoint
    const mcpResource = api.root.addResource("mcp");
    mcpResource.addMethod("ANY", lambdaIntegration, {
      authorizationType: AuthorizationType.COGNITO,
      authorizer: cognitoAuthorizer,
      authorizationScopes: ["mcp-resource-server/dog-facts"],
    });

    // Add endpoint for OAuth protected resource metadata (RFC 9728)
    const oauthProtectedResourceResource = api.root
      .addResource(".well-known")
      .addResource("oauth-protected-resource")
      .addResource("mcp");

    const metadataIntegration = new MockIntegration({
      integrationResponses: [
        {
          statusCode: "200",
          responseParameters: {
            "method.response.header.Content-Type": "'application/json'",
            "method.response.header.Access-Control-Allow-Origin": "'*'",
          },
          responseTemplates: {
            "application/json": JSON.stringify(
              {
                resource_name: "Dog Facts MCP Server",
                resource: `https://${api.restApiId}.execute-api.${this.region}.amazonaws.com/prod/mcp`,
                authorization_servers: [authorizationUrl],
                scopes_supported: ["mcp-resource-server/dog-facts"],
                bearer_methods_supported: ["header"],
              },
              null,
              2
            ),
          },
        },
      ],
      requestTemplates: {
        "application/json": '{"statusCode": 200}',
      },
    });

    const oAuthResourceMetadataGetMethod =
      oauthProtectedResourceResource.addMethod("GET", metadataIntegration, {
        authorizationType: AuthorizationType.NONE,
        methodResponses: [
          {
            statusCode: "200",
            responseParameters: {
              "method.response.header.Content-Type": true,
              "method.response.header.Access-Control-Allow-Origin": true,
            },
          },
        ],
      });

    // Add CDK NAG suppressions
    NagSuppressions.addResourceSuppressions(api, [
      {
        id: "AwsSolutions-APIG2",
        reason:
          "Request validation is handled by the MCP SDK in the Lambda functions",
      },
    ]);

    NagSuppressions.addResourceSuppressions(api.deploymentStage, [
      {
        id: "AwsSolutions-APIG1",
        reason: "Per-API Access logging is not enabled for this example",
      },
      {
        id: "AwsSolutions-APIG3",
        reason: "WAF is not enabled for this example",
      },
      {
        id: "AwsSolutions-APIG6",
        reason: "Per-API CloudWatch logging is not enabled for this example",
      },
    ]);

    NagSuppressions.addResourceSuppressions(oAuthResourceMetadataGetMethod, [
      {
        id: "AwsSolutions-APIG4",
        reason: "OAuth metadata must be unauthenticated per RFC 9728",
      },
      {
        id: "AwsSolutions-COG4",
        reason: "OAuth metadata must be unauthenticated per RFC 9728",
      },
    ]);

    // Outputs
    new cdk.CfnOutput(this, "McpServerUrl", {
      value: `${api.url}mcp`,
      description: "Dog Facts API Gateway URL",
      exportName: `DogFactsMcpServerUrl${stackNameSuffix}`,
    });
  }
}

const app = new cdk.App();
const stackNameSuffix =
  "INTEG_TEST_ID" in process.env ? `-${process.env["INTEG_TEST_ID"]}` : "";
const stack = new DogFactsMcpServer(
  app,
  "LambdaMcpServer-DogFacts",
  stackNameSuffix,
  {
    env: { account: process.env["CDK_DEFAULT_ACCOUNT"], region: "us-east-2" },
    stackName: "LambdaMcpServer-DogFacts" + stackNameSuffix,
  }
);
cdk.Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }));
app.synth();
