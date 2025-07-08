#!/bin/bash

# Script to test automated OAuth flow using client credentials grant

set -e

# Configuration
REGION="us-east-2"
STACK_NAME="LambdaMcpServer-Auth"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

print_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Function to check if required tools are installed
check_dependencies() {
    local missing_deps=()

    if ! command -v aws &> /dev/null; then
        missing_deps+=("aws-cli")
    fi

    if ! command -v oauth2c &> /dev/null; then
        missing_deps+=("oauth2c")
    fi

    if ! command -v curl &> /dev/null; then
        missing_deps+=("curl")
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

# Function to get stack output
get_stack_output() {
    local output_key="$1"

    aws cloudformation describe-stacks \
        --region "$REGION" \
        --stack-name "$STACK_NAME" \
        --query "Stacks[0].Outputs[?OutputKey=='$output_key'].OutputValue" \
        --output text
}

# Function to get client secret from Secrets Manager
get_client_secret() {
    local secret_arn="$1"

    print_info "Retrieving client secret from Secrets Manager..." >&2

    aws secretsmanager get-secret-value \
        --region "$REGION" \
        --secret-id "$secret_arn" \
        --query SecretString \
        --output text
}

# Main function
main() {
    print_info "Testing Automated OAuth Flow (Client Credentials Grant)"
    echo ""

    # Check dependencies
    check_dependencies

    # Get stack outputs
    print_step "1. Retrieving OAuth configuration from CloudFormation stack..."

    AUTHORIZATION_SERVER_URL_RAW=$(get_stack_output "AuthorizationServerUrl")
    USER_POOL_DOMAIN=$(get_stack_output "UserPoolDomain")
    CLIENT_ID=$(get_stack_output "AutomatedOAuthClientId")
    CLIENT_SECRET_ARN=$(get_stack_output "OAuthClientSecretArn")

    if [ -z "$AUTHORIZATION_SERVER_URL_RAW" ] || [ -z "$USER_POOL_DOMAIN" ] || [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET_ARN" ]; then
        print_error "Could not retrieve required stack outputs"
        print_error "Authorization Server URL: $AUTHORIZATION_SERVER_URL_RAW"
        print_error "User Pool Domain: $USER_POOL_DOMAIN"
        print_error "Client ID: $CLIENT_ID"
        print_error "Client Secret ARN: $CLIENT_SECRET_ARN"
        exit 1
    fi

    # Remove trailing slash to avoid double slashes in URLs
    AUTHORIZATION_SERVER_URL="${AUTHORIZATION_SERVER_URL_RAW%/}"

    print_info "✓ Authorization Server URL: $AUTHORIZATION_SERVER_URL"
    print_info "✓ User Pool Domain: $USER_POOL_DOMAIN"
    print_info "✓ Client ID: $CLIENT_ID"

    # Get OAuth endpoints from well-known configuration
    print_step "2. Retrieving OAuth endpoints from well-known configuration..."

    WELL_KNOWN_URL="${AUTHORIZATION_SERVER_URL}/.well-known/oauth-authorization-server"
    print_info "Fetching OAuth metadata from: $WELL_KNOWN_URL"

    OAUTH_CONFIG=$(curl -s "$WELL_KNOWN_URL")
    if [ $? -ne 0 ] || [ -z "$OAUTH_CONFIG" ]; then
        print_error "Failed to retrieve OAuth configuration from well-known endpoint"
        exit 1
    fi

    AUTHORIZATION_URL=$(echo "$OAUTH_CONFIG" | jq -r '.authorization_endpoint')
    TOKEN_URL=$(echo "$OAUTH_CONFIG" | jq -r '.token_endpoint')

    if [ -z "$AUTHORIZATION_URL" ] || [ -z "$TOKEN_URL" ] || [ "$AUTHORIZATION_URL" = "null" ] || [ "$TOKEN_URL" = "null" ]; then
        print_error "Could not extract authorization_endpoint or token_endpoint from OAuth configuration"
        print_error "OAuth Config: $OAUTH_CONFIG"
        exit 1
    fi

    print_info "✓ Authorization URL: $AUTHORIZATION_URL"
    print_info "✓ Token URL: $TOKEN_URL"

    # Get client secret
    print_step "3. Retrieving client secret..."
    CLIENT_SECRET=$(get_client_secret "$CLIENT_SECRET_ARN")

    if [ -z "$CLIENT_SECRET" ]; then
        print_error "Could not retrieve client secret from Secrets Manager"
        exit 1
    fi

    print_info "✓ Client Secret: [HIDDEN]"

    # Display available scopes
    print_step "4. Testing with both available OAuth scopes:"
    print_info "• mcp-resource-server/dad-jokes"
    print_info "• mcp-resource-server/dog-facts"

    SCOPE="mcp-resource-server/dad-jokes mcp-resource-server/dog-facts"
    print_info "Using scopes: $SCOPE"

    echo ""
    print_step "5. Starting OAuth2c client credentials flow..."
    print_warning "This will:"
    print_warning "  1. Authenticate directly with client credentials (no browser)"
    print_warning "  2. Request access tokens for both scopes"
    print_warning "  3. Display the received tokens"
    echo ""

    # Run oauth2c for client credentials flow
    print_step "6. Launching oauth2c (client credentials flow)..."
    echo ""

    oauth2c "$AUTHORIZATION_SERVER_URL" \
        --client-id "$CLIENT_ID" \
        --client-secret "$CLIENT_SECRET" \
        --grant-type "client_credentials" \
        --auth-method "client_secret_basic" \
        --scopes "$SCOPE"

    echo ""
    print_info "Automated OAuth flow completed!"
    print_info "You should now have received access tokens that can be used to authenticate with your MCP servers."
    print_info "These tokens are for machine-to-machine authentication (no user context)."
}

# Run main function
main "$@"
