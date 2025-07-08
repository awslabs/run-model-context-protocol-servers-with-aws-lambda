To set up an AWS account for running integration tests on GitHub:

1. Deploy least-privilege IAM roles:

```bash
aws cloudformation deploy \
    --template-file integ-test-authentication.yaml \
    --stack-name github-integ-test-identity-provider \
    --parameter-overrides GitHubOrg=awslabs RepositoryName=run-model-context-protocol-servers-with-aws-lambda \
    --capabilities CAPABILITY_NAMED_IAM \
    --region us-east-2

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)

cdk bootstrap \
    aws://$AWS_ACCOUNT_ID/us-east-2 \
    --cloudformation-execution-policies "arn:aws:iam::$AWS_ACCOUNT_ID:policy/mcp-lambda-integ-test-cdk-cfn-execution"
```

2. Delegate a sub-domain for the auth stack:

https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/CreatingNewSubdomain.html

3. Deploy the auth stack:

```bash
cd ../examples/servers/auth/

sed -i 's/liguori.people.aws.dev/mcp-lambda-integ-tests.liguori.people.aws.dev/g' lib/mcp-auth.ts

npm install

npm run build

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)

aws iam attach-role-policy \
    --role-name cdk-hnb659fds-cfn-exec-role-$AWS_ACCOUNT_ID-us-east-2 \
    --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

cdk deploy --app 'node lib/mcp-auth.js'

aws iam detach-role-policy \
    --role-name cdk-hnb659fds-cfn-exec-role-$AWS_ACCOUNT_ID-us-east-2 \
    --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

./sync-cognito-user-password.sh
```
