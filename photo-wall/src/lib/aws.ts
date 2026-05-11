import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const region = process.env.AWS_REGION_NAME || process.env.AWS_REGION || "us-east-1";

export const dynamodb = new DynamoDBClient({ region });
export const s3 = new S3Client({ region });
const secretsManager = new SecretsManagerClient({ region });

const secretCache: Record<string, string> = {};

export async function getSecretValue(secretId: string): Promise<string> {
  if (secretCache[secretId]) return secretCache[secretId];
  const result = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: secretId })
  );
  secretCache[secretId] = result.SecretString!;
  return secretCache[secretId];
}
