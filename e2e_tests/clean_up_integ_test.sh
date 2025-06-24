#!/bin/bash

set -ex

# Fail if the file does not exist
if [ ! -f e2e_tests/integ-test-id ]; then
    echo "File e2e_tests/integ-test-id does not exist."
    exit 1
fi

# Read the integ test ID from the file
export INTEG_TEST_ID=$(cat e2e_tests/integ-test-id)

# Clean up CloudFormation stacks
cd examples/servers/time
cdk destroy --force --app 'python3 cdk_stack.py'

cd ../mcpdoc
cdk destroy --force --app 'python3 cdk_stack.py'

cd ../weather-alerts/
cdk destroy --force --app 'node lib/weather-alerts-mcp-server.js'

cd ../cat-facts/
cdk destroy --force --app 'node lib/cat-facts-mcp-server.js'
