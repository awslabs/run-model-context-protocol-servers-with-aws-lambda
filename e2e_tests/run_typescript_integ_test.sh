#!/bin/bash

set -ex

export LOG_LEVEL=debug

cd e2e_tests/typescript

# Run the Typescript integ test
npm ci
npm link @aws/run-mcp-servers-with-aws-lambda
npm run build
npm test
