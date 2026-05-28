#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { TelegramPhotoWallStack } from "../lib/telegram-photo-wall-stack";

const app = new cdk.App();

const ctxGroups = app.node.tryGetContext("telegramGroups") ?? [];
const ctxDomain = app.node.tryGetContext("domain") ?? {};

const telegramGroups = process.env.TELEGRAM_GROUPS
  ? JSON.parse(process.env.TELEGRAM_GROUPS)
  : ctxGroups;

const domainName = process.env.DOMAIN_NAME ?? ctxDomain.name;
const hostedZoneId = process.env.DOMAIN_HOSTED_ZONE_ID ?? ctxDomain.hostedZoneId;
const hostedZoneName = process.env.DOMAIN_HOSTED_ZONE_NAME ?? ctxDomain.hostedZoneName;
const certificateArn = process.env.DOMAIN_CERTIFICATE_ARN ?? ctxDomain.certificateArn;

new TelegramPhotoWallStack(app, "TelegramPhotoWallStack", {
  telegramGroups,
  domainName,
  hostedZoneId,
  hostedZoneName,
  certificateArn,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
