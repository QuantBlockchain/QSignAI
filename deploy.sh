#!/bin/bash
set -e

echo "========================================="
echo "Telegram Photo Wall - AWS Deployment"
echo "========================================="

# Load .env if present (gitignored — holds real domain/groups overrides)
if [ -f .env ]; then
    echo "Loading .env"
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
fi

# Check AWS credentials
echo "Checking AWS credentials..."
aws sts get-caller-identity > /dev/null 2>&1 || {
    echo "ERROR: AWS credentials not configured. Run 'aws configure' first."
    exit 1
}

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=${AWS_DEFAULT_REGION:-us-east-1}
echo "Account: $ACCOUNT_ID"
echo "Region: $REGION"

# Install CDK dependencies
echo ""
echo "Installing CDK dependencies..."
npm install

# Build frontend
echo ""
echo "Building frontend..."
cd photo-wall
npm install
npm run build
cd ..

# Bootstrap CDK (if needed)
echo ""
echo "Bootstrapping CDK..."
npx cdk bootstrap aws://$ACCOUNT_ID/$REGION 2>/dev/null || true

# Deploy
echo ""
echo "Deploying stack..."
npx cdk deploy --require-approval broadening

echo ""
echo "========================================="
echo "Deployment complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. Get the webhook secret:"
echo "   aws secretsmanager get-secret-value --secret-id telegram/webhook-secret --query SecretString --output text"
echo ""
echo "2. Set Telegram webhook for each group:"
echo "   curl -X POST 'https://api.telegram.org/bot<BOT_TOKEN>/setWebhook' \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"url\": \"<WEBHOOK_URL>\", \"secret_token\": \"<WEBHOOK_SECRET>\", \"allowed_updates\": [\"message\"]}'"
echo ""
echo "3. Add the bot to your Telegram group"
