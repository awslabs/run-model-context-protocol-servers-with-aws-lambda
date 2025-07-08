# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [0.3.0](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/compare/v0.2.2...v0.3.0) (2025-06-24)

### Features

* **Streamable HTTP Transport**: Added new HTTP transport implementation for MCP with AWS Lambda
  - Native HTTP communication without stdio bridging
  - Flexible authentication: Built-in custom auth supporting SigV4, OAuth, transitive auth, or enterprise-specific frameworks
  - Real-time streaming support with Server-Sent Events (SSE)
  - Context passing mechanism for HTTP request metadata
  - Comprehensive error handling and retry logic
  - Support for both stateful and stateless modes
  - Complete examples and documentation

## [0.2.2](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/compare/v0.2.1...v0.2.2) (2025-07-06)

### Features

* Add API GW that serves up the .well-known/oauth-authorization-server path expected by MCP clients ([d282fa9](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/d282fa97f274bf54babe10c09f13cd9f9d94151a))
* Add function URL to cat-facts MCP server to enable testing HTTP transport ([8212c2c](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/8212c2c9b1e4593fe9d47e42d066366c46730f95))
* Add Lambda function URL to mcpdoc example ([0764b90](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/0764b903154daf34f4b603e316b2aab226705df4))
* Add Python mcpdoc example that can be the base for a streamable HTTP example ([4943cf3](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/4943cf384bd64df92a30a02e1dc44fdb0fbb4e97))
* Add separate handlers for API Gateway (REST APIs), API Gateway V2 (HTTP APIs), and Lambda function URLs to Typescript impl ([19d2fb4](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/19d2fb448fcfc065d0edcb205cbbfda783aee138))
* Add Typescript cat-facts example that can be the base for a streamable HTTP example ([4b0de89](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/4b0de8978ca626a9746796d9e1632b2a8e26d07b))
* Cognito user pool with OAuth for HTTP access to MCP servers ([de51f6c](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/de51f6c04fded26bd4d53ce89c76ed9971fa22cf))
* Lambda handler logic for streamable HTTP transport behind Lambda function URL ([69208ba](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/69208ba3e74acf23c9b5c7d1e148817df9fea906))
* Migrate from deprecated openapi-mcp-server package to @ivotoby/openapi-mcp-server ([5f9a670](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/5f9a6707a188941cc349fd4b161863c7bb27642c))
* Python function handlers for streamable HTTP ([7c46144](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/7c461449b202d068c562f1bda45c4d949d75da05))
* Support interactive OAuth servers in the Typescript chatbot ([05561fc](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/05561fcbf7878e384c58812406db32986ada4da1))
* Typescript dog-facts MCP server that authenticates with OAuth ([7154adf](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/7154adf8c1954286642a67c7058f1e9e1bca7471))
* Typescript integ test support for OAuth client ([1f7492f](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/1f7492f880910be26bbbf0ff10951bf599b476f9))
* Typescript-based cat-facts MCP server accessible behind Lambda function URL using streamable HTTP transport and Sigv4 ([4a6e83f](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/4a6e83f356063298ef3bf07b030e533633400150))

### Bug Fixes

* Actually initialize the automated oauth clients ([21e76cc](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/21e76cce398e787566fe4203b54d005238494b5c))
* Add dad-jokes server to Typescript chatbot and integ tests ([694e370](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/694e3708c99e96e476f706372669017e293a84bb))
* Correct module path for mcpdoc ([f3b779c](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/f3b779c0ea8daf07c983998ac8ae3eab41986855))
* Disable synthesizing during auth stack GitHub actions check ([23f46d7](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/23f46d7499828942a04d0a2305491ac2ae5e87ac))
* extra comma made cat facts openAPI schema invalid ([3425ee6](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/3425ee6cab11bba3682e8c7f7e24339ad8f4e26e))
* Grant correct secret retrieval perm to integ tests ([c3dae9b](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/c3dae9b2eabfb6df0c463f7ac0aa39bf20a0ae06))
* Implement client credentials token exchange directly ([2db8380](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/2db8380ff2d003f0b5d1c4fb7d8f6d3ba2d0b3c8))
* Implement codeVerifier methods for automated Oauth provider ([ab75d7c](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/ab75d7c3d9f585c82c24be81a7d69840feb58fe4))
* Make sure the cat-facts MCP server advertises that its random facts are about cats ([b26c082](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/b26c0828cc5ddc3d137b490eb6e2a8510093f163))
* Match e2e test Python client pause to the Typescript one ([e735343](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/e735343104e3aa57ac2bee3cd2372d3ecebd05b0))
* Properly parse tool call results from latest schema for MCP Python SDK ([1ee3f06](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/1ee3f06218ef2507a4473757a41e6b9543cb13ba))
* Reduce token usage in e2e_tests to avoid Bedrock token throttling ([bf44cc7](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/bf44cc75e7055d2e220f30672204357a59c5867d))
* Set Bedrock client backoff to handle per-minute throttles ([9a0f6d4](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/9a0f6d423c8f718b664ef3ce7f0cfd48fd19468b))
* Strip down the cat facts OpenAPI schema to save on Bedrock tokens ([c0fd66c](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/c0fd66c645b7dbefa7f616e66d9fee49ebee0925))
* Switch Oauth scope mcpdoc for dad-jokes ([2bed651](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/2bed6519ff55d5dc8835f0b664bc338003d3a2be))
* Switch OAuth-enabled MCP server from cat-facts to dog-facts ([a5041e3](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/a5041e38775c25aa6beb03fc35b2bd1c3a42110e))
* Use authorization server URL to get OAuth token, not MCP server URL ([11ab57c](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/11ab57cd51492aabe1a417d5e38557a0aa4ca406))
* Use CallToolResult type from MCP SDK to properly parse tool results ([a27489c](https://github.com/awslabs/run-model-context-protocol-servers-with-aws-lambda/commit/a27489c4eb5ee17ba51cdda07f2e98ee24884902))

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
