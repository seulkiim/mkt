import { S3Client } from "@aws-sdk/client-s3";

if (!process.env.AWS_PROFILE) {
  throw new Error(
    "AWS_PROFILE is not set. Run: setx AWS_PROFILE idolfarm (then open a new terminal), " +
    "or set it for this shell/session before running s3tool scripts."
  );
}

export const REGION = process.env.AWS_REGION || "ap-northeast-1";
export const BUCKET = "af-datalocker-2026-06-29-13-00-wp";
export const client = new S3Client({ region: REGION });
