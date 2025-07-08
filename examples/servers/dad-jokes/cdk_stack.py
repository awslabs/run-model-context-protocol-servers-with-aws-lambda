from aws_cdk import (
    App,
    Aspects,
    CfnOutput,
    DockerVolume,
    Environment,
    Fn,
    RemovalPolicy,
    Stack,
    aws_apigateway as apigateway,
    aws_cognito as cognito,
    aws_iam as iam,
    aws_lambda as lambda_,
    aws_lambda_python_alpha as lambda_python,
    aws_logs as logs,
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
            # Copy the OpenAPI spec file to the Lambda deployment package
            f"cp {input_dir}/dad-jokes-openapi.json {output_dir}/",
        ]

    @jsii.member(jsii_name="beforeBundling")
    def before_bundling(self, input_dir: str, output_dir: str) -> list[str]:
        return []


class LambdaDadJokesMcpServer(Stack):
    def __init__(
        self, scope: Construct, construct_id: str, stack_name_suffix: str, **kwargs
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        log_group = logs.LogGroup(
            self,
            "ServerFunctionLogGroup",
            log_group_name=f"mcp-server-dad-jokes{stack_name_suffix}",
            retention=logs.RetentionDays.ONE_DAY,
            removal_policy=RemovalPolicy.DESTROY,
        )

        lambda_function = lambda_python.PythonFunction(
            self,
            "ServerFunction",
            function_name="mcp-server-dad-jokes" + stack_name_suffix,
            role=iam.Role.from_role_name(self, "Role", "mcp-lambda-example-servers"),
            log_group=log_group,
            runtime=lambda_.Runtime.PYTHON_3_13,
            entry="function",
            memory_size=2048,
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
                        # Assume we're in examples/servers/dad-jokes dir
                        host_path=os.path.join(os.getcwd(), "../../../src/python"),
                    )
                ],
                command_hooks=CommandHooks(),
            ),
        )

        # Create API Gateway for OAuth-based access
        self.create_api_gateway(lambda_function, stack_name_suffix)

    def create_api_gateway(
        self, lambda_function: lambda_python.PythonFunction, stack_name_suffix: str
    ) -> None:
        """
        Create API Gateway with OAuth authentication.
        This API Gateway will have two paths:
        1. /prod/mcp where the MCP server will be served
        2. /prod/.well-known/oauth-protected-resource/mcp
        Typically, you would set up a custom domain for the API Gateway prod deployment stage,
        such that you would give a URL like https://dad-jokes.example.com/mcp to your consumers.
        """

        # Create Lambda integration
        lambda_integration = apigateway.LambdaIntegration(lambda_function)

        # Import Cognito User Pool from the McpAuth stack
        user_pool_id = Fn.import_value("McpAuth-UserPoolId")
        authorization_url = Fn.import_value("McpAuth-AuthorizationServerUrl")
        user_pool = cognito.UserPool.from_user_pool_id(
            self, "ImportedUserPool", user_pool_id
        )

        # Create Cognito authorizer
        cognito_authorizer = apigateway.CognitoUserPoolsAuthorizer(
            self,
            "CognitoAuthorizer",
            cognito_user_pools=[user_pool],
            identity_source="method.request.header.Authorization",
            authorizer_name="DadJokesCognitoAuthorizer",
        )

        # Create API Gateway
        api = apigateway.RestApi(
            self,
            "DadJokesApiGateway",
            rest_api_name=f"MCP Dad Jokes API Gateway {stack_name_suffix}",
            description="API Gateway for MCP Dad Jokes server with Cognito authorization",
            default_cors_preflight_options=apigateway.CorsOptions(
                allow_origins=apigateway.Cors.ALL_ORIGINS,
                allow_methods=apigateway.Cors.ALL_METHODS,
            ),
            deploy_options=apigateway.StageOptions(
                stage_name="prod",
                throttling_rate_limit=10,
                throttling_burst_limit=20,
            ),
            deploy=True,
            cloud_watch_role=False,  # no logging for this example
        )

        # Configure gateway responses for proper WWW-Authenticate headers to be RFC 9728 compliant
        # The MCP client SDK uses the 'resource_metadata' value to discover the Cognito authorization server
        apigateway.GatewayResponse(
            self,
            "UnauthorizedResponse",
            rest_api=api,
            type=apigateway.ResponseType.UNAUTHORIZED,
            status_code="401",
            response_headers={
                "WWW-Authenticate": f'\'Bearer error="invalid_request", error_description="No access token was provided in this request", resource_metadata="https://{api.rest_api_id}.execute-api.{self.region}.amazonaws.com/prod/.well-known/oauth-protected-resource/mcp"\''
            },
        )

        apigateway.GatewayResponse(
            self,
            "AccessDeniedResponse",
            rest_api=api,
            type=apigateway.ResponseType.ACCESS_DENIED,
            status_code="403",
            response_headers={
                "WWW-Authenticate": "'Bearer error=\"insufficient_scope\"'"
            },
        )

        # Add mcp endpoint
        mcp_resource = api.root.add_resource("mcp")
        mcp_resource.add_method(
            "ANY",
            lambda_integration,
            authorization_type=apigateway.AuthorizationType.COGNITO,
            authorizer=cognito_authorizer,
            authorization_scopes=["mcp-resource-server/dad-jokes"],
        )

        # Add endpoint for OAuth protected resource metadata (RFC 9728)
        well_known_resource = api.root.add_resource(".well-known")
        oauth_protected_resource = well_known_resource.add_resource(
            "oauth-protected-resource"
        )
        mcp_metadata_resource = oauth_protected_resource.add_resource("mcp")

        # Create mock integration for metadata endpoint
        metadata_integration = apigateway.MockIntegration(
            integration_responses=[
                apigateway.IntegrationResponse(
                    status_code="200",
                    response_parameters={
                        "method.response.header.Content-Type": "'application/json'",
                        "method.response.header.Access-Control-Allow-Origin": "'*'",
                    },
                    response_templates={
                        "application/json": json.dumps(
                            {
                                "resource_name": "Dad Jokes MCP Server",
                                "resource": f"https://{api.rest_api_id}.execute-api.{self.region}.amazonaws.com/prod/mcp",
                                "authorization_servers": [authorization_url],
                                "scopes_supported": ["mcp-resource-server/dad-jokes"],
                                "bearer_methods_supported": ["header"],
                            },
                            indent=2,
                        )
                    },
                )
            ],
            request_templates={"application/json": '{"statusCode": 200}'},
        )

        oauth_resource_metadata_get_method = mcp_metadata_resource.add_method(
            "GET",
            metadata_integration,
            authorization_type=apigateway.AuthorizationType.NONE,
            method_responses=[
                apigateway.MethodResponse(
                    status_code="200",
                    response_parameters={
                        "method.response.header.Content-Type": True,
                        "method.response.header.Access-Control-Allow-Origin": True,
                    },
                )
            ],
        )

        # Add CDK NAG suppressions
        NagSuppressions.add_resource_suppressions(
            api,
            [
                {
                    "id": "AwsSolutions-APIG2",
                    "reason": "Request validation is handled by the MCP SDK in the Lambda functions",
                }
            ],
        )

        NagSuppressions.add_resource_suppressions(
            api.deployment_stage,
            [
                {
                    "id": "AwsSolutions-APIG1",
                    "reason": "Per-API Access logging is not enabled for this example",
                },
                {
                    "id": "AwsSolutions-APIG3",
                    "reason": "WAF is not enabled for this example",
                },
                {
                    "id": "AwsSolutions-APIG6",
                    "reason": "Per-API CloudWatch logging is not enabled for this example",
                },
            ],
        )

        NagSuppressions.add_resource_suppressions(
            oauth_resource_metadata_get_method,
            [
                {
                    "id": "AwsSolutions-APIG4",
                    "reason": "OAuth metadata must be unauthenticated per RFC 9728",
                },
                {
                    "id": "AwsSolutions-COG4",
                    "reason": "OAuth metadata must be unauthenticated per RFC 9728",
                },
            ],
        )

        # Output the MCP server URL
        CfnOutput(
            self,
            "McpServerUrl",
            value=f"{api.url}mcp",
            description="Dad Jokes API Gateway URL",
            export_name=f"DadJokesMcpServerUrl{stack_name_suffix}",
        )


app = App()
env = Environment(account=os.environ["CDK_DEFAULT_ACCOUNT"], region="us-east-2")
stack_name_suffix = (
    f'-{os.environ["INTEG_TEST_ID"]}' if "INTEG_TEST_ID" in os.environ else ""
)
stack = LambdaDadJokesMcpServer(
    app,
    "LambdaMcpServer-DadJokes",
    stack_name_suffix,
    stack_name="LambdaMcpServer-DadJokes" + stack_name_suffix,
    env=env,
)
Aspects.of(stack).add(AwsSolutionsChecks(verbose=True))
app.synth()
