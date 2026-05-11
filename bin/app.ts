#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { TelegramPhotoWallStack } from "../lib/telegram-photo-wall-stack";

const app = new cdk.App();

const telegramGroups = app.node.tryGetContext("telegramGroups") ?? [];
const domainConfig = app.node.tryGetContext("domain") ?? {};

new TelegramPhotoWallStack(app, "TelegramPhotoWallStack", {
  telegramGroups,
  domainName: domainConfig.name,
  hostedZoneId: domainConfig.hostedZoneId,
  hostedZoneName: domainConfig.hostedZoneName,
  certificateArn: domainConfig.certificateArn,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
