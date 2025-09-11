# Development guide

## Deploy and run the examples

This guide will walk you through building the source code in this repository,
deploying example MCP servers in Lambda functions,
and using an example chatbot client to communicate with those Lambda-based MCP servers.

The example chatbot client will communicate with ten servers:

1. **dad-jokes**: Ask "Tell me a good dad joke."
2. **dog-facts**: Ask "Tell me something about dogs."
3. **book-search**: Ask "Who wrote the book Pride and Prejudice?"
4. **dictionary**: Ask "How do you pronounce the word 'onomatopoeia'?"
5. **zen**: Ask "Tell me the inspirational quote of the day."
6. **mcpdoc**: Ask "Summarize the first page of the Strands Agents documentation."
7. **cat-facts**: Ask "Tell me something about cats."
8. **time**: Ask "What is the current time?".
9. **weather-alerts**: Ask "Are there any weather alerts right now?".
10. **fetch**: Ask "Who is Tom Cruise?".

| MCP server                                          | Language   | Runtime       | MCP transport                                       | Authentication | Endpoint                  |
| --------------------------------------------------- | ---------- | ------------- | --------------------------------------------------- | -------------- | ------------------------- |
| [dad-jokes](/examples/servers/dad-jokes/)           | Python     | Lambda        | Streamable HTTP transport                           | OAuth          | API Gateway               |
| [dog-facts](/examples/servers/dog-facts/)           | Typescript | Lambda        | Streamable HTTP transport                           | OAuth          | API Gateway               |
| [book-search](/examples/servers/book-search/)       | Python     | Lambda        | Streamable HTTP transport                           | OAuth          | Bedrock AgentCore Gateway |
| [dictionary](/examples/servers/dictionary/)         | Typescript | Lambda        | Streamable HTTP transport                           | OAuth          | Bedrock AgentCore Gateway |
| [zen](/examples/servers/zen/)                       | N/A        | None          | Streamable HTTP transport                           | OAuth          | Bedrock AgentCore Gateway |
| [mcpdoc](/examples/servers/mcpdoc/)                 | Python     | Lambda        | Custom Streamable HTTP transport with SigV4 support | AWS IAM        | Lambda Function URL       |
| [cat-facts](/examples/servers/cat-facts/)           | Typescript | Lambda        | Custom Streamable HTTP transport with SigV4 support | AWS IAM        | Lambda Function URL       |
| [time](/examples/servers/time/)                     | Python     | Lambda        | Custom Lambda Invoke transport                      | AWS IAM        | Lambda Invoke API         |
| [weather-alerts](/examples/servers/weather-alerts/) | Typescript | Lambda        | Custom Lambda Invoke transport                      | AWS IAM        | Lambda Invoke API         |
| [fetch](https://pypi.org/project/mcp-server-fetch/) | Python     | Local process | stdio                                               | N/A            | N/A                       |

Note: The 'zen' MCP server uses Bedrock AgentCore Gateway's built-in support for OpenAPI targets,
so there is no Lambda function in that example.

### Setup

First, install the [AWS CDK CLI](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html#getting_started_install).

Request [Bedrock model access](https://us-west-2.console.aws.amazon.com/bedrock/home?region=us-west-2#/modelaccess)
to Anthropic Claude 3.7 Sonnet in region us-west-2.

Note that the examples will be deployed to us-west-2 by default.
You will need to search and replace 'us-west-2' if you want to choose a different region.

Create an IAM role for the example Lambda functions and bootstrap the account for CDK:

```bash
aws iam create-role \
  --role-name mcp-lambda-example-servers \
  --assume-role-policy-document file://examples/servers/lambda-assume-role-policy.json

aws iam attach-role-policy \
  --role-name mcp-lambda-example-servers \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

aws iam create-role \
  --role-name mcp-lambda-example-agentcore-gateways \
  --assume-role-policy-document file://examples/servers/bedrock-agentcore-gateway-assume-role-policy.json

aws iam put-role-policy \
  --role-name mcp-lambda-example-agentcore-gateways \
  --policy-name bedrock-agentcore-full-access \
  --policy-document file://examples/servers/bedrock-agentcore-gateway-role-policy.json

cdk bootstrap aws://<aws account id>/us-west-2
```

The examples use Cognito for OAuth authentication used by MCP streamable HTTP transport.

Deploy the OAuth authentication stack.

```bash
cd examples/servers/auth

npm install

npm run build

cdk deploy --app 'node lib/mcp-auth.js'

./sync-cognito-user-password.sh
```

Note the command printed by the last script for retrieving Cognito user credentials.
Those credentials are used to log into the OAuth flow.

Test the OAuth configuration with [oauth2c](https://github.com/cloudentity/oauth2c):

```bash
./test-interactive-oauth.sh

./test-automated-oauth.sh
```

### Build the run-mcp-servers-with-aws-lambda library

#### Build the Python module

Install the run-mcp-servers-with-aws-lambda Python module from source:

```bash
cd src/python/

uv venv
source .venv/bin/activate

uv sync --all-extras --dev

# For development
uv run ruff check .
uv run pyright
uv run pytest # coverage report will be in htmlcov/index.html
```

#### Build the Typescript package

Build the @aws/run-mcp-servers-with-aws-lambda Typescript module:

```bash
cd src/typescript/

npm install

npm run build

npm link

# For development
npm test # coverage report will be in coverage/index.html
npm run lint
```

### Deploy the example remote MCP servers

#### Deploy dad-jokes MCP server

Deploy the Lambda 'dad-jokes' function - the deployed function will be named "mcp-server-dad-jokes".

```bash
cd examples/servers/dad-jokes/

uv pip install -r requirements.txt

cdk deploy --app 'python3 cdk_stack.py'
```

#### Deploy dog-facts MCP server

Deploy the Lambda 'dog-facts' function - the deployed function will be named "mcp-server-dog-facts".

```bash
cd examples/servers/dog-facts/

npm install

npm link @aws/run-mcp-servers-with-aws-lambda

npm run build

cdk deploy --app 'node lib/dog-facts-mcp-server.js'
```

#### Deploy book-search MCP server

Deploy the Lambda 'book-search' function - the deployed function will be named "mcp-server-book-search".

```bash
cd examples/servers/book-search/

uv pip install -r requirements.txt

cdk deploy --app 'python3 cdk_stack.py'
```

Then, deploy the Bedrock AgentCore Gateway:

```bash
cd gateway_setup/

uv pip install -r requirements.txt

python setup_gateway.py
```

#### Deploy dictionary MCP server

Deploy the Lambda 'dictionary' function - the deployed function will be named "mcp-server-dictionary".

```bash
cd examples/servers/dictionary/

npm install

npm link @aws/run-mcp-servers-with-aws-lambda

npm run build

cdk deploy --app 'node lib/dictionary-mcp-server.js'
```

Them, deploy the Bedrock AgentCore Gateway:

```bash
cd gateway_setup/

npm install

npm run setup
```

#### Deploy zen MCP server

Deploy the 'zen' Bedrock AgentCore Gateway.

```bash
cd examples/servers/zen/

uv pip install -r requirements.txt

python setup_gateway.py
```

#### Deploy the mcpdoc MCP server

Deploy the Lambda 'mcpdoc' function - the deployed function will be named "mcp-server-mcpdoc".

```bash
cd examples/servers/mcpdoc/

uv pip install -r requirements.txt

cdk deploy --app 'python3 cdk_stack.py'
```

#### Deploy the cat-facts MCP server

Deploy the Lambda 'cat-facts' function - the deployed function will be named "mcp-server-cat-facts".

```bash
cd examples/servers/cat-facts/

npm install

npm link @aws/run-mcp-servers-with-aws-lambda

npm run build

cdk deploy --app 'node lib/cat-facts-mcp-server.js'
```

#### Deploy the time MCP server

Deploy the Lambda 'time' function - the deployed function will be named "mcp-server-time".

```bash
cd examples/servers/time/

uv pip install -r requirements.txt

cdk deploy --app 'python3 cdk_stack.py'
```

#### Deploy the weather-alerts MCP server

Deploy the Lambda 'weather-alerts' function - the deployed function will be named "mcp-server-weather-alerts".

```bash
cd examples/servers/weather-alerts/

npm install

npm link @aws/run-mcp-servers-with-aws-lambda

npm run build

cdk deploy --app 'node lib/weather-alerts-mcp-server.js'
```

### Run the chatbot

#### Run the example Python chatbot

Run the Python-based chatbot client:

```bash
cd examples/chatbots/python/

uv pip install -r requirements.txt

python main.py
```

#### Run the example Typescript chatbot

Run the Typescript-based chatbot client:

```bash
cd examples/chatbots/typescript/

npm install

npm link @aws/run-mcp-servers-with-aws-lambda

npm run build

npm run start
```

## Development tools

Install pre-commit hooks to ensure that your commits follow conventional commit guidelines:

```bash
cd src/python
uv run pre-commit install
```
