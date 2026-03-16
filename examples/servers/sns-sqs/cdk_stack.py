from aws_cdk import (
    App,
    Aspects,
    CfnOutput,
    DockerVolume,
    Duration,
    Environment,
    Fn,
    RemovalPolicy,
    Stack,
    aws_bedrockagentcore as bedrockagentcore,
    aws_iam as iam,
    aws_lambda as lambda_,
    aws_lambda_python_alpha as lambda_python,
    aws_logs as logs,
    aws_s3_assets as s3_assets,
)
from cdk_nag import AwsSolutionsChecks, NagSuppressions
from constructs import Construct
import jsii
import json
import os


@jsii.implements(lambda_python.ICommandHooks)
class CommandHooks:
    @jsii.member(jsii_name="afterBundling")
    def after_bundling(self, input_dir: str, output_dir: str) -> list[str]:
        return [
            # For testing, the run-mcp-servers-with-aws-lambda module is built and
            # bundled from local files. Remove this set of commands if using the
            # run-mcp-servers-with-aws-lambda package from PyPi.
            f"cd {output_dir}",
            f"curl -LsSf https://astral.sh/uv/install.sh | env UV_UNMANAGED_INSTALL='{output_dir}' sh",
            f"mkdir {output_dir}/mcp_lambda_build",
            f"cp /mcp_lambda_src/README.md {output_dir}/mcp_lambda_build/README.md",
            f"cp /mcp_lambda_src/pyproject.toml {output_dir}/mcp_lambda_build/pyproject.toml",
            f"cp /mcp_lambda_src/uv.lock {output_dir}/mcp_lambda_build/uv.lock",
            f"cp -r /mcp_lambda_src/src {output_dir}/mcp_lambda_build/src",
            f"UV_CACHE_DIR={output_dir}/.cache UV_DYNAMIC_VERSIONING_BYPASS=0.0.1 {output_dir}/uv build --wheel --directory {output_dir}/mcp_lambda_build",
            f"python -m pip install {output_dir}/mcp_lambda_build/dist/*.whl -t {output_dir}",
            f"rm -r {output_dir}/mcp_lambda_build {output_dir}/.cache uv",
        ]

    @jsii.member(jsii_name="beforeBundling")
    def before_bundling(self, input_dir: str, output_dir: str) -> list[str]:
        return []


class LambdaSnsSqsMcpServer(Stack):
    def __init__(
        self, scope: Construct, construct_id: str, stack_name_suffix: str, **kwargs
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        log_group = logs.LogGroup(
            self,
            "ServerFunctionLogGroup",
            log_group_name=f"mcp-server-sns-sqs{stack_name_suffix}",
            retention=logs.RetentionDays.ONE_DAY,
            removal_policy=RemovalPolicy.DESTROY,
        )

        server_function = lambda_python.PythonFunction(
            self,
            "ServerFunction",
            function_name="mcp-server-sns-sqs" + stack_name_suffix,
            role=iam.Role.from_role_name(self, "Role", "mcp-lambda-example-servers"),
            log_group=log_group,
            runtime=lambda_.Runtime.PYTHON_3_13,
            entry="function",
            memory_size=2048,
            timeout=Duration.seconds(30),
            environment={
                "LOG_LEVEL": "DEBUG",
            },
            # For testing, the run-mcp-servers-with-aws-lambda module is built and bundled
            # from local files. Remove the bundling configuration if using the
            # run-mcp-servers-with-aws-lambda from PyPi.
            bundling=lambda_python.BundlingOptions(
                volumes=[
                    DockerVolume(
                        container_path="/mcp_lambda_src",
                        host_path=os.path.join(os.getcwd(), "../../../src/python"),
                    )
                ],
                command_hooks=CommandHooks(),
            ),
        )

        # Suppress AwsSolutions-L1 for Python 3.13 runtime
        NagSuppressions.add_resource_suppressions(
            server_function,
            [
                {
                    "id": "AwsSolutions-L1",
                    "reason": "Python 3.13 runtime required due to dependency constraints",
                }
            ],
        )

        # Get gateway name with length limit
        gateway_name = f"LambdaMcpServer-SnsSqs-Gateway{stack_name_suffix}"
        if len(gateway_name) > 48:
            gateway_name = gateway_name[:48].rstrip('-')

        gateway = bedrockagentcore.CfnGateway(
            self,
            "Gateway",
            name=gateway_name,
            role_arn=f"arn:aws:iam::{self.account}:role/mcp-lambda-example-agentcore-gateways",
            protocol_type="MCP",
            authorizer_type="CUSTOM_JWT",
            authorizer_configuration={
                "customJwtAuthorizer": {
                    "allowedClients": [
                        Fn.import_value("McpAuth-InteractiveClientId"),
                        Fn.import_value("McpAuth-AutomatedClientId"),
                    ],
                    "discoveryUrl": Fn.sub(
                        "${IssuerDomain}/.well-known/openid-configuration",
                        {
                            "IssuerDomain": Fn.import_value("McpAuth-IssuerDomain"),
                        }
                    ),
                }
            },
            exception_level="DEBUG",
        )

        # Upload tool schema to S3 asset bucket (too large for inline)
        tool_schema_asset = s3_assets.Asset(
            self,
            "ToolSchemaAsset",
            path=os.path.join(os.path.dirname(__file__), "gateway-tools-list.json"),
        )

        bedrockagentcore.CfnGatewayTarget(
            self,
            "GatewayTarget",
            gateway_identifier=gateway.attr_gateway_identifier,
            name="sns-sqs-target",
            target_configuration={
                "mcp": {
                    "lambda": {
                        "lambdaArn": server_function.function_arn,
                        "toolSchema": {
                            "s3": {
                                "uri": tool_schema_asset.s3_object_url,
                            }
                        },
                    }
                }
            },
            credential_provider_configurations=[
                {"credentialProviderType": "GATEWAY_IAM_ROLE"}
            ],
        )

        CfnOutput(
            self,
            "ServerFunctionOutput",
            value=server_function.function_arn,
        )

        CfnOutput(
            self,
            "GatewayIdOutput",
            value=gateway.attr_gateway_identifier,
        )

        CfnOutput(
            self,
            "McpServerUrl",
            value=gateway.attr_gateway_url,
        )


app = App()
env = Environment(account=os.environ["CDK_DEFAULT_ACCOUNT"], region="us-west-2")
stack_name_suffix = (
    f'-{os.environ["INTEG_TEST_ID"]}' if "INTEG_TEST_ID" in os.environ else ""
)
stack = LambdaSnsSqsMcpServer(
    app,
    "LambdaMcpServer-SnsSqs",
    stack_name_suffix,
    stack_name="LambdaMcpServer-SnsSqs" + stack_name_suffix,
    env=env,
)
Aspects.of(stack).add(AwsSolutionsChecks(verbose=True))
app.synth()
