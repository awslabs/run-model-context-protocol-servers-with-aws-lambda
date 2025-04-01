#!/bin/bash

set -ex

export LOG_LEVEL=debug

# Get UUID to make the CloudFormation stacks unique per run
UUID=$(uuidgen)
export INTEG_TEST_ID=$UUID
echo $INTEG_TEST_ID > ./e2e_tests/integ-test-id

# Deploy Python-based example MCP server
cd src/python
uv sync --frozen --all-extras --dev

cd ../../examples/servers/time
uv pip install -r requirements.txt
cdk deploy --app 'python3 cdk_stack.py'

# Deploy Typescript-based example MCP server
cd ../../../src/typescript/
npm ci
npm run build
npm link

cd ../../examples/servers/weather-alerts/
npm ci
npm link mcp-server-in-aws-lambda
npm run build
cdk deploy --app 'node lib/weather-alerts-mcp-server.js'

# Configure integ tests
cd ../../../e2e_tests/
sed "s/INTEG_TEST_ID/$INTEG_TEST_ID/g" servers_config.integ.json > python/servers_config.json
sed "s/INTEG_TEST_ID/$INTEG_TEST_ID/g" servers_config.integ.json > typescript/servers_config.json

# Run the Python integ test
cd python/
uv pip install -r requirements.txt
python main.py

# Run the Typescript integ test
cd ../typescript/
npm ci
npm link mcp-server-in-aws-lambda
npm run build
npm test
