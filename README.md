# Run Model Context Protocol (MCP) servers with AWS Lambda

[![PyPI - Downloads](https://img.shields.io/pypi/dm/run-mcp-servers-with-aws-lambda?style=for-the-badge&label=PyPi%20Downloads&color=blue)](https://pypi.org/project/run-mcp-servers-with-aws-lambda/)
[![NPM Downloads](https://img.shields.io/npm/dm/%40aws%2Frun-mcp-servers-with-aws-lambda?style=for-the-badge&label=NPM%20Downloads&color=blue)](https://www.npmjs.com/package/@aws/run-mcp-servers-with-aws-lambda)

This project enables you to run [Model Context Protocol](https://modelcontextprotocol.io) stdio-based servers in AWS Lambda functions.

Currently, most implementations of MCP servers and clients are entirely local on a single machine.
A desktop application such as an IDE or Claude Desktop initiates MCP servers locally as child processes
and communicates with each of those servers over a long-running stdio stream.

```mermaid
flowchart LR
    subgraph "Your Laptop"
        Host["Desktop Application<br>with MCP Clients"]
        S1["MCP Server A<br>(child process)"]
        S2["MCP Server B<br>(child process)"]
        Host <-->|"MCP Protocol<br>(over stdio stream)"| S1
        Host <-->|"MCP Protocol<br>(over stdio stream)"| S2
    end
```

This library helps you to wrap existing stdio MCP servers into Lambda functions.
You can invoke these function-based MCP servers from your application using the MCP protocol
over short-lived HTTPS connections.
Your application can then be a desktop-based app, a distributed system running in the cloud,
or any other architecture.

```mermaid
flowchart LR
    subgraph "Distributed System"
        App["Your Application<br>with MCP Clients"]
        S3["MCP Server A<br>(Lambda function)"]
        S4["MCP Server B<br>(Lambda function)"]
        App <-->|"MCP Protocol<br>(over HTTPS connection)"| S3
        App <-->|"MCP Protocol<br>(over HTTPS connection)"| S4
    end
```

Using this library, the Lambda function will manage the lifecycle of your stdio MCP server.
Each Lambda function invocation will:

1. Start the stdio MCP server as a child process
1. Initialize the MCP server
1. Forward the incoming request to the local server
1. Return the server's response to the function caller
1. Shut down the MCP server child process

This library supports connecting to Lambda-based MCP servers in four ways:

1. The [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http), using Amazon API Gateway. Typically authenticated using OAuth.
1. The MCP Streamable HTTP transport, using Amazon Bedrock AgentCore Gateway. Authenticated using OAuth.
1. A custom Streamable HTTP transport with support for SigV4, using a Lambda function URL. Authenticated with AWS IAM.
1. A custom Lambda invocation transport, using the Lambda Invoke API directly. Authenticated with AWS IAM.

## Determine your server parameters

Many stdio-based MCP servers's documentation encourages using tools that download and run the server on-demand.
For example, `uvx my-mcp-server` or `npx my-mcp-server`.
These tools are often not pre-packaged in the Lambda environment, and it can be inefficient to
re-download the server on every Lambda invocation.

Instead, the examples in this repository show how to package the MCP server along with
the Lambda function code, then start it with `python` or `node` (or `npx --offline`) directly.

You will need to determine the right parameters depending on your MCP server's package.
This can often be a trial and error process locally, since MCP server packaging varies.

<details>

<summary><b>Python server examples</b></summary>

Basic example:

```python
from mcp.client.stdio import StdioServerParameters

server_params = StdioServerParameters(
    command=sys.executable,
    args=[
        "-m",
        "my_mcp_server_python_module",
        "--my-server-command-line-parameter",
        "some_value",
    ],
)
```

Locally, you would run this module using:

```bash
python -m my_mcp_server_python_module --my-server-command-line-parameter some_value
```

Other examples:

```bash
python -m mcpdoc.cli # Note the sub-module

python -c "from mcp_openapi_proxy import main; main()"

python -c "import asyncio; from postgres_mcp.server import main; asyncio.run(main())"
```

If you use Lambda layers, you need to also set the PYTHONPATH for the python sub-process:

```python
lambda_paths = ["/opt/python"] + sys.path
env_config = {"PYTHONPATH": ":".join(lambda_paths)}

server_params = StdioServerParameters(
    command=sys.executable,
    args=[
        "-c",
        "from mcp_openapi_proxy import main; main()",
    ],
    env=env_config,
)
```
</details>

<details>

<summary><b>Typescript server examples</b></summary>

Basic example:

```typescript
const serverParams = {
  command: "npx",
  args: [
    "--offline",
    "my-mcp-server-typescript-module",
    "--my-server-command-line-parameter",
    "some_value",
  ],
};
```

Locally, you would run this module using:

```bash
npx --offline my-mcp-server-typescript-module --my-server-command-line-parameter some_value
```

Other examples:
```bash
node /var/task/node_modules/@ivotoby/openapi-mcp-server/bin/mcp-server.js
```

</details>

### Passing credentials and other secrets to the MCP server

This library does not provide out-of-the-box mechanisms for managing any secrets needed by the wrapped
MCP server. For example, the [GitHub MCP server](https://github.com/modelcontextprotocol/servers/tree/main/src/github)
and the [Brave search MCP server](https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search)
require API keys to make requests to third-party APIs.
You may configure these API keys as
[encrypted environment variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars-encryption.html)
in the Lambda function's configuration or retrieve them from Secrets Manager in the Lambda function code (examples below).
However, note that anyone with access to invoke the Lambda function
will then have access to use your API key to call the third-party APIs by invoking the function.
We recommend limiting access to the Lambda function using
[least-privilege IAM policies](https://docs.aws.amazon.com/lambda/latest/dg/security-iam.html).
If you use an identity-based authentication mechanism such as OAuth, you could also store and retrieve API keys per user but there are no implementation examples in this repository.

<details>

<summary><b>Python server example retrieving an API key from Secrets Manager</b></summary>

```python
import sys

import boto3
from mcp.client.stdio import StdioServerParameters

# Retrieve API key from Secrets Manager
secrets_client = boto3.client("secretsmanager")
api_key = secrets_client.get_secret_value(SecretId="my-api-key-secret")["SecretString"]

server_params = StdioServerParameters(
    command=sys.executable,
    args=["-m", "my_mcp_server"],
    env={
        "API_KEY": api_key,
    },
)
```

</details>

<details>

<summary><b>Typescript server example retrieving an API key from Secrets Manager</b></summary>

```typescript
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const secretsClient = new SecretsManagerClient({});
const secret = await secretsClient.send(
  new GetSecretValueCommand({ SecretId: "my-api-key-secret" })
);
const apiKey = secret.SecretString;

const serverParams = {
  command: "npx",
  args: ["--offline", "my-mcp-server"],
  env: {
    API_KEY: apiKey,
  },
};
```

</details>
<br/>

If your MCP server needs to call AWS APIs (such as the [MCP servers for AWS](https://github.com/awslabs/mcp)),
you can pass the Lambda function's AWS credentials to the wrapped MCP server via environment variables.
The wrapped MCP server's child process does not automatically inherit the Lambda execution role's credentials.
Again, note that anyone with access to invoke the Lambda function
will then have access to use the function's AWS credentials to call AWS APIs by invoking the function.
We recommend limiting access to the Lambda function using
[least-privilege IAM policies](https://docs.aws.amazon.com/lambda/latest/dg/security-iam.html).

<details>

<summary><b>Python server example using AWS credentials</b></summary>

```python
import os
import sys

import boto3
from mcp.client.stdio import StdioServerParameters

# Get AWS credentials from Lambda execution role to pass to subprocess
session = boto3.Session()
credentials = session.get_credentials()

server_params = StdioServerParameters(
    command=sys.executable,
    args=["-c", "from awslabs.amazon_sns_sqs_mcp_server.server import main; main()"],
    env={
        "AWS_DEFAULT_REGION": os.environ.get("AWS_REGION", "us-west-2"),
        "AWS_ACCESS_KEY_ID": credentials.access_key,
        "AWS_SECRET_ACCESS_KEY": credentials.secret_key,
        "AWS_SESSION_TOKEN": credentials.token,
    },
)
```

See a full, deployable example [here](examples/servers/sns-sqs/).

</details>

## Use API Gateway

```mermaid
flowchart LR
    App["MCP Client"]
    T1["MCP Server<br>(Lambda function)"]
    T2["API Gateway"]
    T3["OAuth Server<br>(Cognito or similar)"]
    App -->|"MCP Streamable<br>HTTP Transport"| T2
    T2 -->|"Invoke"| T1
    T2 -->|"Authorize"| T3
```

This solution is compatible with most MCP clients that support the streamable HTTP transport.
MCP servers deployed with this architecture can typically be used with off-the-shelf
MCP-compatible applications such as Cursor, Cline, Claude Desktop, etc.

You can choose your desired OAuth server provider for this solution. The examples in this
repository use Amazon Cognito, or you can use third-party providers such as Okta or Auth0
with API Gateway custom authorization.

<details>

<summary><b>Python server example</b></summary>

```python
import sys
from mcp.client.stdio import StdioServerParameters
from mcp_lambda import APIGatewayProxyEventHandler, StdioServerAdapterRequestHandler

server_params = StdioServerParameters(
    command=sys.executable,
    args=[
        "-m",
        "my_mcp_server_python_module",
        "--my-server-command-line-parameter",
        "some_value",
    ],
)


request_handler = StdioServerAdapterRequestHandler(server_params)
event_handler = APIGatewayProxyEventHandler(request_handler)


def handler(event, context):
    return event_handler.handle(event, context)
```

See a full, deployable example [here](examples/servers/dad-jokes/).

</details>

<details>

<summary><b>Typescript server example</b></summary>

```typescript
import {
  Handler,
  Context,
  APIGatewayProxyWithCognitoAuthorizerEvent,
  APIGatewayProxyResult,
} from "aws-lambda";
import {
  APIGatewayProxyEventHandler,
  StdioServerAdapterRequestHandler,
} from "@aws/run-mcp-servers-with-aws-lambda";

const serverParams = {
  command: "npx",
  args: [
    "--offline",
    "my-mcp-server-typescript-module",
    "--my-server-command-line-parameter",
    "some_value",
  ],
};

const requestHandler = new APIGatewayProxyEventHandler(
  new StdioServerAdapterRequestHandler(serverParams)
);

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  return requestHandler.handle(event, context);
};
```

See a full, deployable example [here](examples/servers/dog-facts/).

</details>

<details>

<summary><b>Python client example</b></summary>

```python
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

# Create OAuth client provider here

async with streamablehttp_client(
    url="https://abc123.execute-api.us-west-2.amazonaws.com/prod/mcp",
    auth=oauth_client_provider,
) as (
    read_stream,
    write_stream,
    _,
):
    async with ClientSession(read_stream, write_stream) as session:
        await session.initialize()
        tool_result = await session.call_tool("echo", {"message": "hello"})
```

See a full example as part of the sample chatbot [here](examples/chatbots/python/server_clients/interactive_oauth.py).

</details>

<details>

<summary><b>Typescript client example</b></summary>

```typescript
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const client = new Client(
  {
    name: "my-client",
    version: "0.0.1",
  },
  {
    capabilities: {
      sampling: {},
    },
  }
);

// Create OAuth client provider here

const transport = new StreamableHTTPClientTransport(
  "https://abc123.execute-api.us-west-2.amazonaws.com/prod/mcp",
  {
    authProvider: oauthProvider,
  }
);
await client.connect(transport);
```

See a full example as part of the sample chatbot [here](examples/chatbots/typescript/src/server_clients/interactive_oauth.ts).

</details>

## Use Bedrock AgentCore Gateway

```mermaid
flowchart LR
    App["MCP Client"]
    T1["MCP Server<br>(Lambda function)"]
    T2["Bedrock AgentCore Gateway"]
    T3["OAuth Server<br>(Cognito or similar)"]
    App -->|"MCP Streamable<br>HTTP Transport"| T2
    T2 -->|"Invoke"| T1
    T2 -->|"Authorize"| T3
```

This solution is compatible with most MCP clients that support the streamable HTTP transport.
MCP servers deployed with this architecture can typically be used with off-the-shelf
MCP-compatible applications such as Cursor, Cline, Claude Desktop, etc.

You can choose your desired OAuth server provider with Bedrock AgentCore Gateway,
such as Amazon Cognito, Okta, or Auth0.

Using Bedrock AgentCore Gateway in front of your stdio-based MCP server requires that
you retrieve the MCP server's tool schema, and provide it in the
[AgentCore Gateway Lambda target configuration](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-add-target-lambda.html#gateway-building-lambda-multiple-tools).
AgentCore Gateway can then advertise the schema to HTTP clients and validate request inputs and outputs.

To retrieve and save your stdio-based MCP server's tool schema to a file, run:

```bash
npx @modelcontextprotocol/inspector --cli --method tools/list <your MCP server command and arguments> > tool-schema.json

# For example:
npx @modelcontextprotocol/inspector --cli --method tools/list uvx mcp-server-time > tool-schema.json
```

Some MCP servers generate tool schemas that AgentCore Gateway rejects with strict validation,
such as `"items": {}`, `"default": null`, or `anyOf` with `{"type": "null"}`.
You may need to clean up the schema before using it:

```bash
python3 scripts/clean-tool-schema.py tool-schema.json
```

<details>

<summary><b>Python server example</b></summary>

```python
import sys
from mcp.client.stdio import StdioServerParameters
from mcp_lambda import BedrockAgentCoreGatewayTargetHandler, StdioServerAdapterRequestHandler

server_params = StdioServerParameters(
    command=sys.executable,
    args=[
        "-m",
        "my_mcp_server_python_module",
        "--my-server-command-line-parameter",
        "some_value",
    ],
)


request_handler = StdioServerAdapterRequestHandler(server_params)
event_handler = BedrockAgentCoreGatewayTargetHandler(request_handler)


def handler(event, context):
    return event_handler.handle(event, context)
```

See a full, deployable example [here](examples/servers/book-search/).

</details>

<details>

<summary><b>Typescript server example</b></summary>

```typescript
import { Handler, Context } from "aws-lambda";
import {
  BedrockAgentCoreGatewayTargetHandler,
  StdioServerAdapterRequestHandler,
} from "@aws/run-mcp-servers-with-aws-lambda";

const serverParams = {
  command: "npx",
  args: [
    "--offline",
    "my-mcp-server-typescript-module",
    "--my-server-command-line-parameter",
    "some_value",
  ],
};

const requestHandler = new BedrockAgentCoreGatewayTargetHandler(
  new StdioServerAdapterRequestHandler(serverParams)
);

export const handler: Handler = async (
  event: Record<string, unknown>,
  context: Context
): Promise<Record<string, unknown>> => {
  return requestHandler.handle(event, context);
};
```

See a full, deployable example [here](examples/servers/dictionary/).

</details>

<details>

<summary><b>Python client example</b></summary>

```python
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

# Create OAuth client provider here

async with streamablehttp_client(
    url="https://abc123.gateway.bedrock-agentcore.us-west-2.amazonaws.com/mcp",
    auth=oauth_client_provider,
) as (
    read_stream,
    write_stream,
    _,
):
    async with ClientSession(read_stream, write_stream) as session:
        await session.initialize()
        tool_result = await session.call_tool("echo", {"message": "hello"})
```

See a full example as part of the sample chatbot [here](examples/chatbots/python/server_clients/interactive_oauth.py).

</details>

<details>

<summary><b>Typescript client example</b></summary>

```typescript
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const client = new Client(
  {
    name: "my-client",
    version: "0.0.1",
  },
  {
    capabilities: {
      sampling: {},
    },
  }
);

// Create OAuth client provider here

const transport = new StreamableHTTPClientTransport(
  "https://abc123.gateway.bedrock-agentcore.us-west-2.amazonaws.com/mcp",
  {
    authProvider: oauthProvider,
  }
);
await client.connect(transport);
```

See a full example as part of the sample chatbot [here](examples/chatbots/typescript/src/server_clients/interactive_oauth.ts).

</details>

## Use a Lambda function URL

```mermaid
flowchart LR
    App["MCP Client"]
    T1["MCP Server<br>(Lambda function)"]
    T2["Lambda function URL"]
    App -->|"Custom Streamable HTTP<br>Transport with AWS Auth"| T2
    T2 -->|"Invoke"| T1
```

This solution uses AWS IAM for authentication, and relies on granting
[Lambda InvokeFunctionUrl permission](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html#urls-auth-iam) to your
IAM users and roles to enable access to the MCP server. Clients must use an extension to the MCP Streamable
HTTP transport that signs requests with [AWS SigV4](https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-authenticating-requests.html).
Off-the-shelf MCP-compatible applications are unlikely to have support for this custom transport,
so this solution is more appropriate for service-to-service communication rather than for end users.

<details>

<summary><b>Python server example</b></summary>

```python
import sys
from mcp.client.stdio import StdioServerParameters
from mcp_lambda import LambdaFunctionURLEventHandler, StdioServerAdapterRequestHandler

server_params = StdioServerParameters(
    command=sys.executable,
    args=[
        "-m",
        "my_mcp_server_python_module",
        "--my-server-command-line-parameter",
        "some_value",
    ],
)


request_handler = StdioServerAdapterRequestHandler(server_params)
event_handler = LambdaFunctionURLEventHandler(request_handler)


def handler(event, context):
    return event_handler.handle(event, context)
```

See a full, deployable example [here](examples/servers/mcpdoc/).

</details>

<details>

<summary><b>Typescript server example</b></summary>

```typescript
import {
  Handler,
  Context,
  APIGatewayProxyEventV2WithIAMAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  LambdaFunctionURLEventHandler,
  StdioServerAdapterRequestHandler,
} from "@aws/run-mcp-servers-with-aws-lambda";

const serverParams = {
  command: "npx",
  args: [
    "--offline",
    "my-mcp-server-typescript-module",
    "--my-server-command-line-parameter",
    "some_value",
  ],
};

const requestHandler = new LambdaFunctionURLEventHandler(
  new StdioServerAdapterRequestHandler(serverParams)
);

export const handler: Handler = async (
  event: APIGatewayProxyEventV2WithIAMAuthorizer,
  context: Context
): Promise<APIGatewayProxyResultV2> => {
  return requestHandler.handle(event, context);
};
```

See a full, deployable example [here](examples/servers/cat-facts/).

</details>

<details>

<summary><b>Python client example</b></summary>

```python
from mcp import ClientSession
from mcp_proxy_for_aws.client import aws_iam_streamablehttp_client

async with aws_iam_streamablehttp_client(
    endpoint="https://url-id-12345.lambda-url.us-west-2.on.aws",
    aws_service="lambda",
    aws_region="us-west-2",
) as (
    read_stream,
    write_stream,
    _,
):
    async with ClientSession(read_stream, write_stream) as session:
        await session.initialize()
        tool_result = await session.call_tool("echo", {"message": "hello"})
```

See a full example as part of the sample chatbot [here](examples/chatbots/python/server_clients/lambda_function_url.py).

</details>

<details>

<summary><b>Typescript client example</b></summary>

```typescript
import { StreamableHTTPClientWithSigV4Transport } from "@aws/run-mcp-servers-with-aws-lambda";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const client = new Client(
  {
    name: "my-client",
    version: "0.0.1",
  },
  {
    capabilities: {
      sampling: {},
    },
  }
);

const transport = new StreamableHTTPClientWithSigV4Transport(
  new URL("https://url-id-12345.lambda-url.us-west-2.on.aws"),
  {
    service: "lambda",
    region: "us-west-2",
  }
);
await client.connect(transport);
```

See a full example as part of the sample chatbot [here](examples/chatbots/typescript/src/server_clients/lambda_function_url.ts).

</details>

## Use the Lambda Invoke API

```mermaid
flowchart LR
    App["MCP Client"]
    T1["MCP Server<br>(Lambda function)"]
    App -->|"Custom MCP Transport<br>(Lambda Invoke API)"| T1
```

Like the Lambda function URL approach, this solution uses AWS IAM for authentication.
It relies on granting
[Lambda InvokeFunction permission](https://docs.aws.amazon.com/lambda/latest/dg/lambda-api-permissions-ref.html)
to your IAM users and roles to enable access to the MCP server.
Clients must use a custom MCP transport that directly calls the
[Lambda Invoke API](https://docs.aws.amazon.com/lambda/latest/api/API_Invoke.html).
Off-the-shelf MCP-compatible applications are unlikely to have support for this custom transport,
so this solution is more appropriate for service-to-service communication rather than for end users.

<details>

<summary><b>Python server example</b></summary>

```python
import sys
from mcp.client.stdio import StdioServerParameters
from mcp_lambda import stdio_server_adapter

server_params = StdioServerParameters(
    command=sys.executable,
    args=[
        "-m",
        "my_mcp_server_python_module",
        "--my-server-command-line-parameter",
        "some_value",
    ],
)


def handler(event, context):
    return stdio_server_adapter(server_params, event, context)
```

See a full, deployable example [here](examples/servers/time/).

</details>

<details>

<summary><b>Typescript server example</b></summary>

```typescript
import { Handler, Context } from "aws-lambda";
import { stdioServerAdapter } from "@aws/run-mcp-servers-with-aws-lambda";

const serverParams = {
  command: "npx",
  args: [
    "--offline",
    "my-mcp-server-typescript-module",
    "--my-server-command-line-parameter",
    "some_value",
  ],
};

export const handler: Handler = async (event, context: Context) => {
  return await stdioServerAdapter(serverParams, event, context);
};
```

See a full, deployable example [here](examples/servers/weather-alerts/).

</details>

<details>

<summary><b>Python client example</b></summary>

```python
from mcp import ClientSession
from mcp_lambda import LambdaFunctionParameters, lambda_function_client

server_params = LambdaFunctionParameters(
    function_name="my-mcp-server-function",
    region_name="us-west-2",
)

async with lambda_function_client(server_params) as (
    read_stream,
    write_stream,
):
    async with ClientSession(read_stream, write_stream) as session:
        await session.initialize()
        tool_result = await session.call_tool("echo", {"message": "hello"})
```

See a full example as part of the sample chatbot [here](examples/chatbots/python/server_clients/lambda_function.py).

</details>

<details>

<summary><b>Typescript client example</b></summary>

```typescript
import {
  LambdaFunctionParameters,
  LambdaFunctionClientTransport,
} from "@aws/run-mcp-servers-with-aws-lambda";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const serverParams: LambdaFunctionParameters = {
  functionName: "my-mcp-server-function",
  regionName: "us-west-2",
};

const client = new Client(
  {
    name: "my-client",
    version: "0.0.1",
  },
  {
    capabilities: {
      sampling: {},
    },
  }
);

const transport = new LambdaFunctionClientTransport(serverParams);
await client.connect(transport);
```

See a full example as part of the sample chatbot [here](examples/chatbots/typescript/src/server_clients/lambda_function.ts).

</details>

## Related projects

- To write custom MCP servers in Lambda functions,
  see the [MCP Lambda Handler](https://github.com/awslabs/mcp/tree/main/src/mcp-lambda-handler) project.
- To invoke existing Lambda functions as tools through a stdio MCP server,
  see the [AWS Lambda Tool MCP Server](https://awslabs.github.io/mcp/servers/lambda-tool-mcp-server/) project.

## Considerations

- This library currently supports MCP servers and clients written in Python and Typescript.
  Other languages such as Kotlin are not supported.
- This library only adapts stdio MCP servers for Lambda, not servers written for other protocols such as SSE.
- This library does not maintain any MCP server state or sessions across Lambda function invocations.
  Only stateless MCP servers are a good fit for using this library. For example, MCP servers
  that invoke stateless tools like the [time MCP server](https://github.com/modelcontextprotocol/servers/tree/main/src/time)
  or make stateless web requests like the [fetch MCP server](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch).
  Stateful MCP servers are not a good fit, because they will lose their state on every request.
  For example, MCP servers that manage data on disk or in memory such as
  the [sqlite MCP server](https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite),
  the [filesystem MCP server](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem),
  and the [git MCP server](https://github.com/modelcontextprotocol/servers/tree/main/src/git).

## Deploy and run the examples

See the [development guide](DEVELOP.md) for instructions to deploy and run the examples in this repository.

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This project is licensed under the Apache-2.0 License.
