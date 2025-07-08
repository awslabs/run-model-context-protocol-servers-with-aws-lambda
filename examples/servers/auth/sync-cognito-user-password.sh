#!/bin/bash

# Script to set a permanent password for the MCP user in Cognito User Pool

set -e

# Configuration
REGION="us-east-2"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if required tools are installed
check_dependencies() {
    local missing_deps=()

    if ! command -v aws &> /dev/null; then
        missing_deps+=("aws-cli")
    fi

    if ! command -v jq &> /dev/null; then
        missing_deps+=("jq")
    fi

    if [ ${#missing_deps[@]} -ne 0 ]; then
        print_error "Missing required dependencies: ${missing_deps[*]}"
        print_error "Please install the missing tools and try again."
        exit 1
    fi
}

# Function to get stack outputs
get_stack_output() {
    local output_key="$1"
    local stack_name="LambdaMcpServer-Auth"

    aws cloudformation describe-stacks \
        --region "$REGION" \
        --stack-name "$stack_name" \
        --query "Stacks[0].Outputs[?OutputKey=='$output_key'].OutputValue" \
        --output text
}

# Function to get credentials from Secrets Manager
get_credentials_from_secret() {
    local secret_arn="$1"

    print_info "Retrieving credentials from Secrets Manager..." >&2

    aws secretsmanager get-secret-value \
        --region "$REGION" \
        --secret-id "$secret_arn" \
        --query SecretString \
        --output text
}

# Function to sync password from Secrets Manager to Cognito
sync_password_to_cognito() {
    local user_pool_id="$1"
    local username="$2"
    local password="$3"

    print_info "Syncing password from Secrets Manager to Cognito for user: $username"

    aws cognito-idp admin-set-user-password \
        --region "$REGION" \
        --user-pool-id "$user_pool_id" \
        --username "$username" \
        --password "$password" \
        --permanent \
        --output json > /dev/null

    print_info "Password successfully synced to Cognito!"
}

# Main function
main() {
    print_info "Starting password sync for MCP user..."

    # Check dependencies
    check_dependencies

    # Get stack outputs
    print_info "Retrieving stack information..."
    USER_POOL_ID=$(get_stack_output "UserPoolId")
    SECRET_ARN=$(get_stack_output "UserCredentialsSecretArn")

    if [ -z "$USER_POOL_ID" ] || [ -z "$SECRET_ARN" ]; then
        print_error "Could not retrieve required stack outputs"
        print_error "User Pool ID: $USER_POOL_ID"
        print_error "Secret ARN: $SECRET_ARN"
        exit 1
    fi

    print_info "User Pool ID: $USER_POOL_ID"
    print_info "Secret ARN: $SECRET_ARN"

    # Get credentials from Secrets Manager
    CREDENTIALS=$(get_credentials_from_secret "$SECRET_ARN")

    if [ -z "$CREDENTIALS" ]; then
        print_error "Could not retrieve credentials from Secrets Manager"
        exit 1
    fi

    # Extract username and password from the secret
    USERNAME=$(echo "$CREDENTIALS" | jq -r '.username')
    PASSWORD=$(echo "$CREDENTIALS" | jq -r '.password')

    if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ] || [ "$USERNAME" = "null" ] || [ "$PASSWORD" = "null" ]; then
        print_error "Could not extract username or password from Secrets Manager"
        print_error "Expected secret format: {\"username\": \"...\", \"password\": \"...\"}"
        exit 1
    fi

    print_info "Credentials retrieved from Secrets Manager successfully"
    print_info "Username: $USERNAME"

    # Sync the password to Cognito
    sync_password_to_cognito "$USER_POOL_ID" "$USERNAME" "$PASSWORD"

    print_info "Password sync completed successfully!"
    print_info "User '$USERNAME' can now sign in with the credentials from Secrets Manager."
    print_info "To retrieve credentials: aws secretsmanager get-secret-value --secret-id '$SECRET_ARN' --query SecretString --output text"
}

# Run main function
main "$@"
