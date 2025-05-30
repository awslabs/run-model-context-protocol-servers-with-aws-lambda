# Development guide

## Deploy and run the examples

This guide will walk you through building the source code in this repository,
deploying example MCP servers in Lambda functions,
and using an example chatbot client to communicate with those Lambda-based MCP servers.

The example chatbot client will communicate with three servers:

1. a Lambda function-based 'time' MCP server (Python)
1. a Lambda function-based MCP server that interacts with Amazon SNS and SQS APIs (Python)
1. a Lambda function-based 'weather-alerts' MCP server (Typescript)
1. a [local 'fetch' MCP server](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch)

To use the remote 'time' server, you can ask the chatbot questions like "What is the current time?".

To use the remote SNS and SQS server, you can ask the chatbot questions like "How many SQS queues do I have in us-east-1?".

To use the remote 'weather-alerts' server, you can ask the chatbot questions like "Are there any weather alerts right now?".

To use the local 'fetch' server, you can ask questions like "Who is Tom Cruise?".

### Setup

First, install the [AWS CDK CLI](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html#getting_started_install).

Request [Bedrock model access](https://us-west-2.console.aws.amazon.com/bedrock/home?region=us-west-2#/modelaccess)
to Anthropic Claude 3.5 Sonnet v2 in region us-west-2.

Create an IAM role for the example Lambda functions and bootstrap the account for CDK:

```bash
aws iam create-role \
  --role-name mcp-lambda-example-servers \
  --assume-role-policy-document file://examples/servers/lambda-assume-role-policy.json

aws iam attach-role-policy \
  --role-name mcp-lambda-example-servers \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

aws iam attach-role-policy \
  --role-name mcp-lambda-example-servers \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonSNSReadOnlyAccess

aws iam attach-role-policy \
  --role-name mcp-lambda-example-servers \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonSQSReadOnlyAccess

cdk bootstrap aws://<aws account id>/us-east-2
```

### Build the Python module

Install the run-mcp-servers-with-aws-lambda Python module from source:

```bash
cd src/python/

uv venv
source .venv/bin/activate

uv sync --all-extras --dev

# For development
uv run ruff check .
uv run pyright
uv run pytest
```

### Build the Typescript package

Build the @aws/run-mcp-servers-with-aws-lambda Typescript module:

```bash
cd src/typescript/

npm install

npm run build

npm link
```

### Deploy the example Python servers

Deploy the Lambda 'time' function - the deployed function will be named "mcp-server-time".

```bash
cd examples/servers/time/

uv pip install -r requirements.txt

cdk deploy --app 'python3 cdk_stack.py'
```

Deploy the Lambda function for the SNS and SQS MCP server - the deployed function will be named "mcp-server-sns-sqs".

```bash
cd examples/servers/sns-sqs/

uv pip install -r requirements.txt

cdk deploy --app 'python3 cdk_stack.py'
```

### Deploy the example Typescript server

Deploy the Lambda 'weather-alerts' function - the deployed function will be named "mcp-server-weather-alerts".

```bash
cd examples/servers/weather-alerts/

npm install

npm link @aws/run-mcp-servers-with-aws-lambda

npm run build

cdk deploy --app 'node lib/weather-alerts-mcp-server.js'
```

### Run the example Python client

Run the Python-based chatbot client:

```bash
cd examples/chatbots/python/

uv pip install -r requirements.txt

python main.py
```

### Run the example Typescript client

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

```
cd src/python
uv run pre-commit install
```
