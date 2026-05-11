import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as iam from "aws-cdk-lib/aws-iam";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53targets from "aws-cdk-lib/aws-route53-targets";
import { Construct } from "constructs";

export interface TelegramGroupConfig {
  groupId: string;
  chatId: string;
  name: string;
  secretName: string;
}

export interface TelegramPhotoWallStackProps extends cdk.StackProps {
  telegramGroups: TelegramGroupConfig[];
  domainName?: string;       // e.g. "wall.example.com"
  hostedZoneId?: string;     // Route53 hosted zone ID
  hostedZoneName?: string;   // e.g. "example.com"
  certificateArn?: string;   // ACM certificate ARN (us-east-1)
}

export class TelegramPhotoWallStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: TelegramPhotoWallStackProps
  ) {
    super(scope, id, props);

    // ===========================
    // Secret header to prevent direct ALB access
    // ===========================
    const cfSecretHeaderName = "X-CloudFront-Secret";
    const cfSecretHeaderValue = cdk.Fn.select(
      2,
      cdk.Fn.split("/", `${cdk.Aws.STACK_ID}`)
    );

    // ===========================
    // DynamoDB Table
    // ===========================
    const messagesTable = new dynamodb.Table(this, "MessagesTable", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ===========================
    // S3 Bucket for Photos
    // ===========================
    const photoBucket = new s3.Bucket(this, "PhotoBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      serverAccessLogsPrefix: "access-logs/",
    });

    // ===========================
    // S3 Bucket for Braket results (must start with "amazon-braket-")
    // ===========================
    const braketBucketName = `amazon-braket-photowall-${this.account}-${this.region}`;
    const braketBucket = s3.Bucket.fromBucketName(
      this,
      "BraketBucket",
      braketBucketName
    );

    // ===========================
    // Secrets Manager - Webhook verification secret
    // ===========================
    const webhookSecret = new secretsmanager.Secret(this, "WebhookSecret", {
      secretName: "telegram/webhook-secret",
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 64,
      },
    });

    const adminSecret = new secretsmanager.Secret(this, "AdminSecret", {
      secretName: "telegram/admin-password",
      generateSecretString: {
        excludePunctuation: false,
        passwordLength: 16,
      },
    });

    // ===========================
    // VPC
    // ===========================
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // ===========================
    // ALB Security Group
    // ===========================
    const albSg = new ec2.SecurityGroup(this, "AlbSecurityGroup", {
      vpc,
      description: "ALB Security Group - allows HTTP from CloudFront only",
      allowAllOutbound: true,
    });

    const cfPrefixList = ec2.PrefixList.fromLookup(
      this,
      "CloudFrontPrefixList",
      {
        prefixListName: "com.amazonaws.global.cloudfront.origin-facing",
      }
    );

    albSg.addIngressRule(
      ec2.Peer.prefixList(cfPrefixList.prefixListId),
      ec2.Port.tcp(80),
      "Allow HTTP from CloudFront managed prefix list"
    );

    // ===========================
    // ECS Cluster
    // ===========================
    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      containerInsights: true,
    });

    // ===========================
    // ECS Task Definition
    // ===========================
    const taskDefinition = new ecs.FargateTaskDefinition(this, "TaskDef", {
      memoryLimitMiB: 1024,
      cpu: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    // Grant DynamoDB and S3 access to the task role
    messagesTable.grantReadWriteData(taskDefinition.taskRole);
    photoBucket.grantReadWrite(taskDefinition.taskRole);
    webhookSecret.grantRead(taskDefinition.taskRole);
    adminSecret.grantRead(taskDefinition.taskRole);

    // Grant Braket access for quantum signature generation (SV1)
    braketBucket.grantReadWrite(taskDefinition.taskRole);
    taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "braket:CreateQuantumTask",
          "braket:GetQuantumTask",
          "braket:GetDevice",
        ],
        resources: ["*"],
      })
    );

    // Grant read access to each group's bot token secret
    for (const group of props.telegramGroups) {
      const secret = secretsmanager.Secret.fromSecretNameV2(
        this,
        `Secret-${group.groupId}`,
        group.secretName
      );
      secret.grantRead(taskDefinition.taskRole);
    }

    const logGroup = new logs.LogGroup(this, "AppLogGroup", {
      logGroupName: `/ecs/telegram-photo-wall`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const container = taskDefinition.addContainer("NextjsApp", {
      image: ecs.ContainerImage.fromAsset("./photo-wall", {
        platform: cdk.aws_ecr_assets.Platform.LINUX_AMD64,
      }),
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: "nextjs",
      }),
      environment: {
        NODE_ENV: "production",
        PORT: "3000",
        TABLE_NAME: messagesTable.tableName,
        BUCKET_NAME: photoBucket.bucketName,
        WEBHOOK_SECRET_ARN: webhookSecret.secretArn,
        GROUP_CONFIG: JSON.stringify(props.telegramGroups),
        AWS_REGION_NAME: this.region,
        BRAKET_BUCKET: braketBucket.bucketName,
        ADMIN_SECRET_ARN: adminSecret.secretArn,
      },
    });

    container.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP,
    });

    // ===========================
    // ECS Service Security Group
    // ===========================
    const serviceSg = new ec2.SecurityGroup(this, "ServiceSecurityGroup", {
      vpc,
      description: "ECS Service Security Group",
      allowAllOutbound: true,
    });

    serviceSg.addIngressRule(
      albSg,
      ec2.Port.tcp(3000),
      "Allow traffic from ALB"
    );

    // ===========================
    // Application Load Balancer
    // ===========================
    const alb = new elbv2.ApplicationLoadBalancer(this, "ALB", {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    alb.setAttribute(
      "routing.http.drop_invalid_header_fields.enabled",
      "true"
    );

    // ===========================
    // ALB Target Group - Health check on /api/health
    // ===========================
    const targetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "TargetGroup",
      {
        vpc,
        port: 3000,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targetType: elbv2.TargetType.IP,
        healthCheck: {
          path: "/api/health",
          interval: cdk.Duration.seconds(15),
          timeout: cdk.Duration.seconds(5),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 2,
          healthyHttpCodes: "200",
        },
        deregistrationDelay: cdk.Duration.seconds(30),
      }
    );

    // ===========================
    // ALB Listener
    // ===========================
    const listener = alb.addListener("HttpListener", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.fixedResponse(403, {
        contentType: "text/plain",
        messageBody: "Forbidden - Direct access not allowed",
      }),
    });

    listener.addAction("ForwardWithSecret", {
      priority: 1,
      conditions: [
        elbv2.ListenerCondition.httpHeader(cfSecretHeaderName, [
          cfSecretHeaderValue,
        ]),
      ],
      action: elbv2.ListenerAction.forward([targetGroup]),
    });

    // ===========================
    // ECS Fargate Service
    // ===========================
    const service = new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition,
      desiredCount: 1,
      securityGroups: [serviceSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
      circuitBreaker: { rollback: true },
    });

    service.attachToApplicationTargetGroup(targetGroup);

    // ===========================
    // Auto Scaling
    // ===========================
    const scaling = service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 4,
    });

    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(30),
    });

    // ===========================
    // CloudFront Distribution
    // ===========================
    const logBucket = new s3.Bucket(this, "CfLogsBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [{ expiration: cdk.Duration.days(90) }],
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const dynamicCachePolicy = cloudfront.CachePolicy.CACHING_DISABLED;

    const staticCachePolicy = new cloudfront.CachePolicy(
      this,
      "StaticCachePolicy",
      {
        cachePolicyName: `${this.stackName}-Static`,
        minTtl: cdk.Duration.days(1),
        maxTtl: cdk.Duration.days(365),
        defaultTtl: cdk.Duration.days(30),
        headerBehavior: cloudfront.CacheHeaderBehavior.none(),
        queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
        cookieBehavior: cloudfront.CacheCookieBehavior.none(),
        enableAcceptEncodingGzip: true,
        enableAcceptEncodingBrotli: true,
      }
    );

    const albOrigin = new origins.HttpOrigin(alb.loadBalancerDnsName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      customHeaders: {
        [cfSecretHeaderName]: cfSecretHeaderValue,
      },
    });

    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
      this,
      "SecurityHeaders",
      {
        responseHeadersPolicyName: `${this.stackName}-Security`,
        securityHeadersBehavior: {
          contentTypeOptions: { override: true },
          frameOptions: {
            frameOption: cloudfront.HeadersFrameOption.SAMEORIGIN,
            override: true,
          },
          referrerPolicy: {
            referrerPolicy:
              cloudfront.HeadersReferrerPolicy
                .STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
            override: true,
          },
          strictTransportSecurity: {
            accessControlMaxAge: cdk.Duration.days(365),
            includeSubdomains: true,
            override: true,
          },
          xssProtection: {
            protection: true,
            modeBlock: true,
            override: true,
          },
        },
      }
    );

    // Origin request policy for webhook - forwards Telegram secret header
    const webhookOriginRequestPolicy = new cloudfront.OriginRequestPolicy(
      this,
      "WebhookOriginRequestPolicy",
      {
        originRequestPolicyName: `${this.stackName}-Webhook`,
        headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
          "X-Telegram-Bot-Api-Secret-Token"
        ),
        queryStringBehavior:
          cloudfront.OriginRequestQueryStringBehavior.all(),
        cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
      }
    );

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: albOrigin,
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: dynamicCachePolicy,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        responseHeadersPolicy,
      },
      additionalBehaviors: {
        "_next/static/*": {
          origin: albOrigin,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: staticCachePolicy,
          responseHeadersPolicy,
        },
        "api/webhook/*": {
          origin: albOrigin,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: dynamicCachePolicy,
          originRequestPolicy: webhookOriginRequestPolicy,
        },
        "api/*": {
          origin: albOrigin,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: dynamicCachePolicy,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
          responseHeadersPolicy,
        },
      },
      ...(props.domainName && props.certificateArn
        ? {
            domainNames: [props.domainName],
            certificate: acm.Certificate.fromCertificateArn(
              this,
              "Certificate",
              props.certificateArn
            ),
          }
        : {}),
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      logBucket,
      logFilePrefix: "cf-logs/",
    });

    // ===========================
    // Route53 A record (if domain configured)
    // ===========================
    if (props.domainName && props.hostedZoneId && props.hostedZoneName) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(
        this,
        "HostedZone",
        {
          hostedZoneId: props.hostedZoneId,
          zoneName: props.hostedZoneName,
        }
      );

      new route53.ARecord(this, "AliasRecord", {
        zone,
        recordName: props.domainName,
        target: route53.RecordTarget.fromAlias(
          new route53targets.CloudFrontTarget(distribution)
        ),
      });
    }

    // ===========================
    // Outputs
    // ===========================
    new cdk.CfnOutput(this, "CloudFrontURL", {
      value: `https://${distribution.distributionDomainName}`,
      description: "CloudFront URL (use this to access the photo wall)",
    });

    new cdk.CfnOutput(this, "ALBDnsName", {
      value: alb.loadBalancerDnsName,
      description: "ALB DNS (direct access blocked)",
    });

    new cdk.CfnOutput(this, "CloudFrontDistributionId", {
      value: distribution.distributionId,
      description: "CloudFront Distribution ID",
    });

    for (const group of props.telegramGroups) {
      new cdk.CfnOutput(this, `WebhookUrl-${group.groupId}`, {
        value: `https://${distribution.distributionDomainName}/api/webhook/${group.groupId}`,
        description: `Telegram Webhook URL for group: ${group.name}`,
      });
    }

    new cdk.CfnOutput(this, "PhotoWallUrlPattern", {
      value: `https://${distribution.distributionDomainName}/wall/{groupId}`,
      description: "Photo wall URL pattern",
    });
  }
}
