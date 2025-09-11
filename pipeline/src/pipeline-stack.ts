#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as codeconnections from "aws-cdk-lib/aws-codeconnections";

export class McpServersPipelineStack extends cdk.Stack {
  // Common server definitions
  private readonly servers = [
    { name: "dad-jokes", language: "python" },
    { name: "dog-facts", language: "typescript" },
    { name: "book-search", language: "python" },
    { name: "dictionary", language: "typescript" },
    { name: "mcpdoc", language: "python" },
    { name: "cat-facts", language: "typescript" },
    { name: "time", language: "python" },
    { name: "weather-alerts", language: "typescript" },
  ] as const;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // CodeConnections connection for GitHub
    const githubConnection = new codeconnections.CfnConnection(
      this,
      "GitHubConnection",
      {
        connectionName: "mcp-servers-github-connection",
        providerType: "GitHub",
      }
    );

    // S3 bucket for pipeline artifacts
    const artifactsBucket = new s3.Bucket(this, "PipelineArtifacts", {
      bucketName: `mcp-servers-pipeline-artifacts-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // Source artifact
    const sourceOutput = new codepipeline.Artifact("SourceOutput");

    // IAM role for CodeBuild projects
    const codeBuildRole = iam.Role.fromRoleName(
      this,
      "CodeBuildRole",
      "mcp-servers-codebuild"
    );

    // Build project for Python library
    const pythonLibBuild = new codebuild.Project(this, "PythonLibBuild", {
      role: codeBuildRole,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          install: {
            commands: [
              "curl -LsSf https://astral.sh/uv/install.sh | sh",
              'export PATH="$HOME/.local/bin:$PATH"',
            ],
          },
          build: {
            commands: [
              "cd src/python",
              "uv venv",
              ". .venv/bin/activate",
              "uv sync --all-extras --dev",
              "uv run ruff check .",
              "uv run pyright",
              "uv run pytest",
            ],
          },
        },
        artifacts: {
          files: ["**/*"],
          "base-directory": "src/python",
        },
      }),
    });

    // Build project for TypeScript library
    const typescriptLibBuild = new codebuild.Project(
      this,
      "TypescriptLibBuild",
      {
        role: codeBuildRole,
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
          computeType: codebuild.ComputeType.SMALL,
        },
        buildSpec: codebuild.BuildSpec.fromObject({
          version: "0.2",
          phases: {
            install: {
              "runtime-versions": {
                nodejs: "22",
              },
            },
            pre_build: {
              commands: ["cd src/typescript", "npm install"],
            },
            build: {
              commands: ["npm run build", "npm test", "npm run lint"],
            },
          },
          artifacts: {
            files: ["**/*"],
            "base-directory": "src/typescript",
          },
        }),
      }
    );

    // Build project for Auth stack
    const authStackBuild = new codebuild.Project(this, "AuthStackBuild", {
      role: codeBuildRole,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          install: {
            "runtime-versions": {
              nodejs: "22",
            },
            commands: ["npm install -g aws-cdk"],
          },
          pre_build: {
            commands: [
              // Create IAM role if it doesn't exist
              `aws iam create-role --role-name mcp-lambda-example-servers --assume-role-policy-document file://examples/servers/lambda-assume-role-policy.json || true`,
              `aws iam attach-role-policy --role-name mcp-lambda-example-servers --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole || true`,
              "cd examples/servers/auth",
              "npm install",
            ],
          },
          build: {
            commands: [
              "npm run build",
              'cdk deploy --app "node lib/mcp-auth.js" --require-approval never',
              "./sync-cognito-user-password.sh",
            ],
          },
        },
      }),
    });

    // Build projects for each MCP server
    const serverBuilds = this.createServerBuildProjects(codeBuildRole);

    // Create the pipeline
    const pipeline = new codepipeline.Pipeline(this, "McpServersPipeline", {
      pipelineName: "lambda-mcp-servers-deployment",
      artifactBucket: artifactsBucket,
      stages: [
        // Source stage
        {
          stageName: "Source",
          actions: [
            new codepipeline_actions.CodeStarConnectionsSourceAction({
              actionName: "GitHub_Source",
              owner: "awslabs", // Update this to your GitHub username/org
              repo: "run-model-context-protocol-servers-with-aws-lambda", // Update this to your repo name
              branch: "main",
              connectionArn: githubConnection.attrConnectionArn,
              output: sourceOutput,
            }),
          ],
        },
        // Build libraries stage
        {
          stageName: "BuildLibraries",
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: "BuildPythonLib",
              project: pythonLibBuild,
              input: sourceOutput,
            }),
            new codepipeline_actions.CodeBuildAction({
              actionName: "BuildTypescriptLib",
              project: typescriptLibBuild,
              input: sourceOutput,
            }),
          ],
        },
        // Deploy auth stack
        {
          stageName: "DeployAuth",
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: "DeployAuthStack",
              project: authStackBuild,
              input: sourceOutput,
            }),
          ],
        },
        // Deploy MCP servers stage
        {
          stageName: "DeployMcpServers",
          actions: [
            ...this.createServerDeployActions(serverBuilds, sourceOutput),
          ],
        },
      ],
    });

    // Output the pipeline name
    new cdk.CfnOutput(this, "PipelineName", {
      value: pipeline.pipelineName,
      description: "Name of the MCP servers deployment pipeline",
    });

    // Output the GitHub connection ARN
    new cdk.CfnOutput(this, "GitHubConnectionArn", {
      value: githubConnection.attrConnectionArn,
      description:
        "ARN of the GitHub CodeConnections connection - complete the handshake in the AWS Console",
    });

    // Output the pipeline console URL
    new cdk.CfnOutput(this, "PipelineConsoleUrl", {
      value: `https://${this.region}.console.aws.amazon.com/codesuite/codepipeline/pipelines/${pipeline.pipelineName}/view?region=${this.region}`,
      description: "URL to view the pipeline in the AWS Console",
    });

    // Output the Code connections console URL
    new cdk.CfnOutput(this, "CodeConnectionsConsoleUrl", {
      value: `https://${this.region}.console.aws.amazon.com/codesuite/settings/connections?region=${this.region}`,
      description: "URL to manage the GitHub connection in the AWS Console",
    });
  }

  private createServerBuildProjects(codeBuildRole: iam.IRole): {
    [key: string]: codebuild.Project;
  } {
    const builds: { [key: string]: codebuild.Project } = {};

    this.servers.forEach((server) => {
      const buildSpec =
        server.language === "python"
          ? this.createPythonServerBuildSpec(server.name)
          : this.createTypescriptServerBuildSpec(server.name);

      builds[server.name] = new codebuild.Project(this, `${server.name}Build`, {
        projectName: `mcp-server-${server.name}-deploy`,
        role: codeBuildRole,
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
          computeType: codebuild.ComputeType.SMALL,
        },
        buildSpec,
      });
    });

    // Add zen server with custom deployment
    builds["zen"] = new codebuild.Project(this, "zenBuild", {
      projectName: "mcp-server-zen-deploy",
      role: codeBuildRole,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          install: {
            commands: [
              "curl -LsSf https://astral.sh/uv/install.sh | sh",
              'export PATH="$HOME/.local/bin:$PATH"',
            ],
          },
          build: {
            commands: [
              "cd examples/servers/zen",
              "uv venv",
              ". .venv/bin/activate",
              "uv pip install -r requirements.txt",
              "python teardown_gateway.py",
              "python setup_gateway.py",
            ],
          },
        },
      }),
    });

    return builds;
  }

  private createPythonServerBuildSpec(serverName: string): codebuild.BuildSpec {
    return codebuild.BuildSpec.fromObject({
      version: "0.2",
      phases: {
        install: {
          commands: [
            "npm install -g aws-cdk",
            "curl -LsSf https://astral.sh/uv/install.sh | sh",
            'export PATH="$HOME/.local/bin:$PATH"',
          ],
        },
        build: {
          commands: [
            // Build library
            "cd $CODEBUILD_SRC_DIR/src/python",
            "uv venv",
            ". .venv/bin/activate",
            "uv sync --frozen --all-extras --dev",

            // Build server example
            `cd $CODEBUILD_SRC_DIR/examples/servers/${serverName}`,
            "uv pip install -r requirements.txt",

            // Deploy server example
            'cdk deploy --app "python3 cdk_stack.py" --require-approval never',

            // Run gateway setup if directory exists
            `if [ -d "$CODEBUILD_SRC_DIR/examples/servers/${serverName}/gateway_setup" ]; then cd "$CODEBUILD_SRC_DIR/examples/servers/${serverName}/gateway_setup" && uv pip install -r requirements.txt && python teardown_gateway.py && python setup_gateway.py; fi`,
          ],
        },
      },
    });
  }

  private createTypescriptServerBuildSpec(
    serverName: string
  ): codebuild.BuildSpec {
    return codebuild.BuildSpec.fromObject({
      version: "0.2",
      phases: {
        install: {
          "runtime-versions": {
            nodejs: "22",
          },
          commands: ["npm install -g aws-cdk"],
        },
        build: {
          commands: [
            // Build library
            "cd $CODEBUILD_SRC_DIR/src/typescript",
            "npm ci",
            "npm run build",
            "npm link",

            // Build server example
            `cd $CODEBUILD_SRC_DIR/examples/servers/${serverName}`,
            "npm ci",
            "npm link @aws/run-mcp-servers-with-aws-lambda",
            "npm run build",

            // Deploy server example
            `cdk deploy --app "node lib/${serverName}-mcp-server.js" --require-approval never`,

            // Run gateway setup if directory exists
            `if [ -d "$CODEBUILD_SRC_DIR/examples/servers/${serverName}/gateway_setup" ]; then cd "$CODEBUILD_SRC_DIR/examples/servers/${serverName}/gateway_setup" && npm ci && npm run teardown && npm run setup; fi`,
          ],
        },
      },
    });
  }

  private createServerDeployActions(
    serverBuilds: { [key: string]: codebuild.Project },
    sourceOutput: codepipeline.Artifact
  ): codepipeline_actions.CodeBuildAction[] {
    const actions = this.servers.map((server) => {
      const inputs = [sourceOutput];

      return new codepipeline_actions.CodeBuildAction({
        actionName: `Deploy${server.name
          .split("-")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join("")}`,
        project: serverBuilds[server.name],
        input: sourceOutput,
        extraInputs: inputs.slice(1), // All inputs except the primary one
        runOrder: 1, // All servers can deploy in parallel
      });
    });

    // Add zen server deployment action
    actions.push(
      new codepipeline_actions.CodeBuildAction({
        actionName: "DeployZen",
        project: serverBuilds["zen"],
        input: sourceOutput,
        runOrder: 1,
      })
    );

    return actions;
  }
}

// CDK App instantiation
const app = new cdk.App();

new McpServersPipelineStack(app, "McpServersPipelineStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "us-west-2", // Pipeline region
  },
});

app.synth();
