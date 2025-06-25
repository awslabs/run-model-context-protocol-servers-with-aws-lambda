# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [0.3.0](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/compare/v0.2.1...v0.3.0) (2025-06-24)

### Features

* **Streamable HTTP Transport**: Added new HTTP transport implementation for MCP with AWS Lambda
  - Native HTTP communication without stdio bridging
  - Built-in AWS SigV4 authentication
  - Real-time streaming support with Server-Sent Events (SSE)
  - Context passing mechanism for Lambda event data
  - Comprehensive error handling and retry logic
  - Support for both stateful and stateless modes
  - Complete examples and documentation

## [0.2.1](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/compare/v0.2.0...v0.2.1) (2025-06-03)

## [0.2.0](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/compare/v0.1.6...v0.2.0) (2025-05-30)

MCP 1.8.0 [introduced a new format for MCP client messages (SessionMessage)](https://github.com/modelcontextprotocol/python-sdk/commit/da0cf223553d50e48fba7652b2ef0eca26550e77).
This 0.2.0 version upgrades the MCP version from MCP 1.6.0 to 1.9.2, and uses the new SessionMessage format for the Lambda client-side transport.

### ⚠ BREAKING CHANGES

* Use new MCP SessionMessage for Lambda client transport

### Features

* Use new MCP SessionMessage for Lambda client transport ([35125c5](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/35125c5e22172544c5a07f17c4174e1b4c792fea))

## [0.1.6](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/compare/v0.1.5...v0.1.6) (2025-05-27)


### Bug Fixes

* Format response text from server in example client implementation ([c0523cf](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/c0523cf087422726a657a6c5866af1c0fbaa24d3))

## [0.1.5](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/compare/v0.1.4...v0.1.5) (2025-05-13)

## [0.1.4](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/compare/v0.1.3...v0.1.4) (2025-04-22)

## [0.1.3](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/compare/v0.1.2...v0.1.3) (2025-04-15)

## [0.1.1](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/compare/v0.1.0...v0.1.1) (2025-04-15)

## [0.0.2](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/compare/v0.0.1...v0.0.2) (2025-04-01)
