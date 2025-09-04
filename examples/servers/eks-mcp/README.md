# Amazon EKS MCP Server

This directory contains the Amazon EKS MCP (Model Context Protocol) Server deployed as an AWS Lambda function for integration with Bedrock AgentCore Gateway.

> **Source Code**: The EKS MCP server implementation is available at [awslabs/mcp/eks-mcp-server](https://github.com/awslabs/mcp/tree/main/src/eks-mcp-server)

## Overview

The EKS MCP Server provides AI agents with comprehensive Amazon EKS cluster management capabilities through the Model Context Protocol. It enables seamless integration between AI systems and Kubernetes infrastructure.

### Key Features

- 🚀 **EKS Cluster Management** - List, describe, and manage EKS clusters
- ⚙️ **Kubernetes Operations** - CRUD operations on Kubernetes resources
- 📊 **CloudWatch Integration** - Access to logs and metrics for monitoring
- 🤖 **AI Agent Ready** - Optimized for Bedrock AgentCore Gateway integration

## Quick Start

Deploy the EKS MCP Server using AWS CDK:

```bash
# Install CDK dependencies
pip install -r requirements-cdk.txt

# Ensure CDK is bootstrapped in your account
cdk bootstrap
```

```bash
# Set your AWS account ID (required)
export CDK_DEFAULT_ACCOUNT=YOUR_ACCOUNT_ID

# Test the CDK stack configuration
python3 cdk_stack.py

# Deploy the stack
cdk deploy --app "python3 cdk_stack.py"
```

```bash
# For integration testing with a specific test ID:
export INTEG_TEST_ID=my-test-123
cdk deploy --app "python3 cdk_stack.py"
```

### Successful Deployment Output

After successful deployment, you'll see output similar to:

```
✅  LambdaMcpServer-Eks

Outputs:
LambdaMcpServer-Eks.FunctionUrl = https://abcdefghijk.lambda-url.us-east-1.on.aws/
Stack ARN:
arn:aws:cloudformation:us-east-1:[ACCOUNT-ID]:stack/LambdaMcpServer-Eks/1234567890
```

### Deployment Requirements
- **Runtime**: Python 3.11
- **Handler**: `index.handler`
- **Memory**: 2048MB
- **Function Name**: `eksmcp`
- **Authentication**: AWS IAM via Function URL
- **Timeout**: Default Lambda timeout for complex operations

## Architecture

The deployment creates:

- **Lambda Function** (`mcp-server-eks`) - Python 3.11 runtime with EKS MCP server
- **IAM Role** - Least privilege permissions for EKS and CloudWatch operations
- **Function URL** - IAM-authenticated endpoint for AgentCore Gateway integration
- **CloudWatch Logs** - Centralized logging with configurable retention

## Project Structure

```
examples/servers/eks-mcp/
├── cdk_stack.py           # CDK infrastructure definition
├── requirements-cdk.txt   # CDK dependencies
├── requirements.txt       # Legacy CDK dependencies (deprecated)
├── function/              # Lambda function code
│   ├── __init__.py       # Python package marker
│   ├── index.py          # Lambda handler implementation
│   └── requirements.txt  # Lambda runtime dependencies
└── README.md             # This documentation
```

## Deployment

### Prerequisites

- AWS CDK installed and configured
- AWS credentials with appropriate permissions
- Python 3.11+ environment

### Deploy

```bash
# From the eks-mcp directory
export CDK_DEFAULT_ACCOUNT=YOUR_ACCOUNT_ID
cdk deploy --app "python3 cdk_stack.py"
```

### CDK Commands

```bash
# List available stacks
cdk list --app "python3 cdk_stack.py"

# Preview changes before deployment
cdk diff --app "python3 cdk_stack.py"

# Deploy with account ID
export CDK_DEFAULT_ACCOUNT=YOUR_ACCOUNT_ID
cdk deploy --app "python3 cdk_stack.py"

# Clean up resources
cdk destroy --app "python3 cdk_stack.py" --force
```

## Configuration

### IAM Permissions

The Lambda execution role includes:

**AWS Managed Policies:**
- `AWSLambdaBasicExecutionRole` - Basic Lambda execution
- `AmazonEKSClusterPolicy` - EKS cluster management
- `AmazonEKSWorkerNodePolicy` - EKS worker node operations
- `AmazonEKS_CNI_Policy` - EKS CNI networking
- `CloudWatchReadOnlyAccess` - Read-only CloudWatch access (security improvement)

**Custom Inline Policies:**
- EKS API operations (describe, list, access)
- EC2 VPC operations for networking
- Additional EKS-specific permissions

### Environment Variables

- `FASTMCP_LOG_LEVEL` - Set to "ERROR" for minimal logging
- AWS credentials automatically provided by Lambda execution role

## Network Connectivity

### Lambda to EKS Cluster Communication

The Lambda function communicates with EKS clusters through AWS APIs. Ensure proper network configuration:

#### For Public EKS Endpoints
- ✅ No additional network configuration required
- ✅ Lambda function has internet access by default

#### For Private EKS Endpoints
- ✅ Lambda function deployed in same VPC as EKS cluster
- ✅ Security group allows outbound HTTPS (port 443) to EKS control plane
- ✅ Security group allows outbound DNS (port 53) for name resolution

### Security Group Configuration

If using private EKS endpoints, configure Lambda security group:

Outbound HTTPS for AWS APIs Protocol: TCP, Port: 443, Destination: EKS control plane security group

Outbound DNS resolution Protocol: UDP/TCP, Port: 53, Destination: VPC DNS

### Required IAM Permissions

Minimum IAM permissions for EKS access, customize based on your needs with least privilege principles:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "eks:DescribeCluster",
        "eks:AccessKubernetesApi"
      ],
      "Resource": "arn:aws:eks:*:*:cluster/*"
    }
  ]
}
```

## Testing & Validation

### Basic Function Test using AgentCore Gateway CLI

```bash
echo -n '{"prompt": "list all pods inside bmn-rack-op-cluster"}' | base64 > /tmp/payload.txt

aws bedrock-agentcore invoke-agent-runtime --agent-runtime-arn "arn:aws:bedrock-agentcore:us-east-1:[ACCOUNT-ID]:runtime/eks-agent-xyyyz" --payload "$(cat /tmp/payload.txt)" /tmp/result.json
```

### EKS Connectivity Test

```bash
# Verify EKS cluster status
aws eks describe-cluster --name <cluster-name>

# Test network connectivity (from Lambda environment)
curl -I https://<cluster-endpoint>
nslookup <cluster-endpoint>
```

### Expected Performance

- **Execution Time**: < 1 second for basic operations
- **AWS API Access**: No timeout errors
- **Cluster Endpoint**: Successful HTTPS connection
- **DNS Resolution**: Cluster FQDN resolves correctly

## Troubleshooting

### Common Issues Checklist

- [ ] Lambda function has access to target EKS cluster
- [ ] EKS cluster allows Lambda security group communication
- [ ] Lambda security group permits outbound HTTPS to EKS endpoint
- [ ] Lambda security group permits outbound DNS requests
- [ ] Lambda IAM role has required EKS permissions
- [ ] Target EKS cluster is in ACTIVE status
- [ ] Function timeout is sufficient (minimum 300 seconds)

### Connectivity Issues

If experiencing timeout errors:

1. **Check VPC Configuration**: Ensure Lambda can reach EKS endpoints
2. **Verify Security Groups**: Confirm outbound rules allow HTTPS/DNS
3. **Review IAM Permissions**: Validate EKS access permissions
4. **Test Cluster Status**: Ensure EKS cluster is healthy and accessible

## Real-World Usage Example

Here's an example of the EKS MCP Server in action using Strands agent integrated with a Bedrock AgentCore Gateway:

```bash
$ python3 agent.py
🌍 AWS region configured: us-east-1
✅ Successfully connected to AgentCore Gateway: eks-agentcore-gw-asdfgh
🔗 Setting up MCP client for gateway: eks-agentcore-gw-asdfgh
✅ MCP client configured successfully
🤖 Using MODEL_ID: us.anthropic.claude-3-5-haiku-20241022-v1:0
✅ Added 16 AgentCore Gateway MCP tools

You > list all my pods on bmn-rack-op-cluster
I'll help you list the pods on the bmn-rack-op-cluster.

Here's a summary of the pods in the default namespace:

1. **MLNX DPDK Pods** (Network-related):
   - mlnx-dpdk-1001-1002-node1-rx/rx2/tx/tx2
   - High-performance networking pods using Mellanox DPDK

2. **Demo/Test Pods**:
   - nginx-demo: Simple Nginx web server

3. **Node Debugger Pods**:
   - Multiple node-debugger-* pods (11 total)
   - Temporary debugging pods for node-level diagnostics

**Total**: 16 pods in default namespace

Key observations:
- Most pods are networking-related (MLNX DPDK)
- Single demo application running
- Several debugging pods present

Would you like more details about any specific pods?

You > summarize the cluster health status over the past 7 days
I'll retrieve the cluster health insights:
Tool #15: eksmcpsigitp___get_eks_insights
I'll also check the VPC configuration:
Tool #16: eksmcpsigitp___get_eks_vpc_config
Cluster Health Status Summary:

1. Overall Cluster Health:
- Status: PASSING
- Kubernetes Version: 1.33
- No critical health issues detected

2. Key Health Insights:
a) Kube-Proxy Version:
   - Status: PASSING
   - Reason: Versions match cluster control plane

b) Amazon Linux Compatibility:
   - Status: PASSING
   - No Amazon Linux 2 nodes detected
   - Note: Amazon Linux 2 support ends November 26, 2025

c) EKS Add-on Compatibility:
   - Status: PASSING
   - All add-on versions compatible with next Kubernetes version

d) Kubelet Version:
   - Status: PASSING
   - Node kubelet versions match control plane version

3. Network Configuration:
- VPC ID: vpc-0009d1f19d76b5073
- CIDR Block: 10.0.0.0/16
- Subnets: 8 subnets across 3 AZs (us-east-1a, us-east-1b, us-east-1c)
  - 5 public subnets
  - 3 private subnets
- Internet Gateway: Active
- Sufficient IP addressing (3,340-4,091 IPs per subnet)

4. Potential Considerations:
- Multi-AZ deployment for high availability
- Robust network configuration
- No immediate upgrade or compatibility concerns

🟢 CLUSTER OVERVIEW
- Cluster Name: bmn-rack-op-cluster
- Total Pods: 31
- Namespaces: 5 (default, kube-system, amazon-cloudwatch, monitoring, prometheus-node-exporter)

🔍 SYSTEM COMPONENTS STATUS
- CoreDNS: 2/2 pods running ✅
- AWS VPC CNI: Running ✅
- Kube-proxy: Running ✅
- Node Monitoring: Operational ✅
- Pod Identity Agent: Active ✅

⚠️ POTENTIAL OBSERVATIONS
1. Multiple MLNX DPDK network testing pods suggest ongoing network performance evaluation
2. Presence of node-debugger pods indicates potential troubleshooting activities
3. Comprehensive monitoring setup with CloudWatch, Prometheus, and SRIOV metrics

Recommendations:
1. Plan for Amazon Linux 2 phase-out by November 2025
2. Continue monitoring cluster add-on and component versions
3. Maintain current networking and security configurations
4. Consider future Kubernetes version upgrades

Would you like me to:
1. Provide more detailed network analysis
2. Discuss potential future upgrade strategies
3. Explore any specific aspect of cluster health
4. Recommend optimization techniques
You >

You > list all pods inside bmn-rack-op-cluster, breakdown based on namespaces
I'll list the pods for the bmn-rack-outposts-cluster, organized by namespaces:
Tool #17: eksmcpsigitp___list_k8s_resources
Breakdown of Pods by Namespace:

1. default (13 pods):
   - Network Performance Pods:
     * mlnx-dpdk-1001-1002-node1-rx
     * mlnx-dpdk-1001-1002-node1-rx2
     * mlnx-dpdk-1001-1002-node1-tx
     * mlnx-dpdk-1001-1002-node1-tx2
   - Web/Demo Pods:
     * nginx-demo
   - Debugging Pods:
     * 10 node-debugger pods (all on ip-10-0-58-16.ec2.internal)

2. kube-system (12 pods):
   - Networking:
     * aws-node (VPC CNI)
     * coredns (2 pods)
     * kube-proxy
     * kube-multus
     * kube-sriov-cni
     * kube-sriov-device-plugin
     * whereabouts
   - Monitoring/Management:
     * eks-node-monitoring-agent
     * eks-pod-identity-agent

3. amazon-cloudwatch (3 pods):
   - Logging and Observability:
     * amazon-cloudwatch-observability-controller-manager
     * cloudwatch-agent
     * fluent-bit

4. monitoring (1 pod):
   - Metrics:
     * sriov-metrics-exporter

5. prometheus-node-exporter (1 pod):
   - Metrics Collection:
     * prometheus-node-exporter

Total Pods: 31

Key Observations:
- Heavy focus on network performance testing (MLNX DPDK pods)
- Comprehensive monitoring and logging setup
- Multiple debugging pods
- Standard EKS system components are present

Would you like me to elaborate on any specific namespace or set of pods?

```

This demonstrates the EKS MCP Server successfully:
- Connecting to EKS clusters
- Listing Kubernetes resources
- Providing intelligent analysis of cluster state
- Enabling natural language interaction with Kubernetes infrastructure

## References

- Review the [EKS MCP Server documentation](https://github.com/awslabs/mcp/tree/main/src/eks-mcp-server)
- Check AWS CloudWatch logs for detailed Lambda function logging information
- Verify network connectivity and IAM permissions