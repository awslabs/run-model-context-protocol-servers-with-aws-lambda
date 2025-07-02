import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import {
  Code,
  LayerVersion,
  Runtime,
  FunctionUrl,
  FunctionUrlAuthType,
} from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Role } from "aws-cdk-lib/aws-iam";
import { AwsSolutionsChecks } from "cdk-nag";
import * as path from "path";

export class CatFactsMcpServer extends cdk.Stack {
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
      logGroupName: "mcp-server-cat-facts" + stackNameSuffix,
      retention: RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const lambdaFunction = new NodejsFunction(this, "function", {
      functionName: "mcp-server-cat-facts" + stackNameSuffix,
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
            return [`cp ${inputDir}/cat-facts-openapi.json ${outputDir}/`];
          },
          beforeInstall(inputDir: string, outputDir: string) {
            return [];
          },
        },
      },
    });

    // URL with AWS IAM authorization for HTTP transport
    const functionUrl = new FunctionUrl(this, "FunctionUrl", {
      function: lambdaFunction,
      authType: FunctionUrlAuthType.AWS_IAM,
    });

    new cdk.CfnOutput(this, "FunctionUrlOutput", {
      value: functionUrl.url,
      exportName: `CatFactsServerUrl${stackNameSuffix}`,
    });
  }
}

const app = new cdk.App();
const stackNameSuffix =
  "INTEG_TEST_ID" in process.env ? `-${process.env["INTEG_TEST_ID"]}` : "";
const stack = new CatFactsMcpServer(
  app,
  "LambdaMcpServer-CatFacts",
  stackNameSuffix,
  {
    env: { account: process.env["CDK_DEFAULT_ACCOUNT"], region: "us-east-2" },
    stackName: "LambdaMcpServer-CatFacts" + stackNameSuffix,
  }
);
cdk.Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }));
app.synth();
