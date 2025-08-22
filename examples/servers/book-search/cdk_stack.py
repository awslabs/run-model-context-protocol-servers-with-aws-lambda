from aws_cdk import (
    App,
    Aspects,
    CfnOutput,
    DockerVolume,
    Duration,
    Environment,
    RemovalPolicy,
    Stack,
    aws_iam as iam,
    aws_lambda as lambda_,
    aws_lambda_python_alpha as lambda_python,
    aws_logs as logs,
)
from cdk_nag import AwsSolutionsChecks
from constructs import Construct
import jsii
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
            # Copy the OpenAPI spec file to the Lambda deployment package
            f"cp {input_dir}/open-library-openapi.json {output_dir}/",
        ]

    @jsii.member(jsii_name="beforeBundling")
    def before_bundling(self, input_dir: str, output_dir: str) -> list[str]:
        return []


class LambdaBookSearchMcpServer(Stack):
    def __init__(
        self, scope: Construct, construct_id: str, stack_name_suffix: str, **kwargs
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        log_group = logs.LogGroup(
            self,
            "ServerFunctionLogGroup",
            log_group_name=f"mcp-server-book-search{stack_name_suffix}",
            retention=logs.RetentionDays.ONE_DAY,
            removal_policy=RemovalPolicy.DESTROY,
        )

        server_function = lambda_python.PythonFunction(
            self,
            "ServerFunction",
            function_name="mcp-server-book-search" + stack_name_suffix,
            role=iam.Role.from_role_name(self, "Role", "mcp-lambda-example-servers"),
            log_group=log_group,
            runtime=lambda_.Runtime.PYTHON_3_13,
            entry="function",
            memory_size=2048,
            timeout=Duration.seconds(10),
            environment={
                "LOG_LEVEL": "DEBUG",
            },
            # For testing, the run-mcp-servers-with-aws-lambda module is built and bundled
            # from local files. Remove the bundling configuration if using the
            # run-mcp-servers-with-aws-lambda from PyPi.
            bundling=lambda_python.BundlingOptions(
                # asset_excludes=[".venv", ".mypy_cache", "__pycache__"],
                volumes=[
                    DockerVolume(
                        container_path="/mcp_lambda_src",
                        # Assume we're in examples/servers/book-search dir
                        host_path=os.path.join(os.getcwd(), "../../../src/python"),
                    )
                ],
                command_hooks=CommandHooks(),
            ),
        )

        CfnOutput(
            self,
            "ServerFunctionOutput",
            value=server_function.function_arn,
        )


app = App()
env = Environment(account=os.environ["CDK_DEFAULT_ACCOUNT"], region="us-west-2")
stack_name_suffix = (
    f'-{os.environ["INTEG_TEST_ID"]}' if "INTEG_TEST_ID" in os.environ else ""
)
stack = LambdaBookSearchMcpServer(
    app,
    "LambdaMcpServer-BookSearch",
    stack_name_suffix,
    stack_name="LambdaMcpServer-BookSearch" + stack_name_suffix,
    env=env,
)
Aspects.of(stack).add(AwsSolutionsChecks(verbose=True))
app.synth()
