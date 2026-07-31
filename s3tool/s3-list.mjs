import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { client, BUCKET as bucket } from "./aws-client.mjs";


async function listObjects(prefix = "", depth = 0) {
  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
    Delimiter: "/",
    MaxKeys: 100,
  });

  const response = await client.send(command);
  const indent = "  ".repeat(depth);

  if (response.CommonPrefixes) {
    for (const p of response.CommonPrefixes) {
      console.log(`${indent}📁 ${p.Prefix}`);
      if (depth < 2) await listObjects(p.Prefix, depth + 1);
    }
  }

  if (response.Contents) {
    for (const obj of response.Contents) {
      const size = (obj.Size / 1024).toFixed(1);
      console.log(`${indent}📄 ${obj.Key} (${size} KB)`);
    }
  }
}

console.log(`\n📦 버킷: ${bucket}\n`);
listObjects().catch(console.error);
