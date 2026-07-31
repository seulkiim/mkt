import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { client, BUCKET as bucket } from "./aws-client.mjs";


const prefix = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/t=inapps/";

// 전체 파일 목록 조회
const cmd = new ListObjectsV2Command({
  Bucket: bucket,
  Prefix: prefix,
  MaxKeys: 1000,
});

const resp = await client.send(cmd);

// 6월 파일만 필터
const juneFiles = (resp.Contents || []).filter(o =>
  o.Key.includes("2026-06") && o.Size > 0
);

console.log(`총 ${juneFiles.length}개 6월 파일 발견:\n`);
juneFiles.forEach(f => console.log(`${f.Key} (${(f.Size/1024).toFixed(1)} KB)`));

// 폴더 구조도 확인
const prefixes = (resp.CommonPrefixes || []);
if (prefixes.length > 0) {
  console.log("\n폴더 구조:");
  prefixes.forEach(p => console.log(p.Prefix));
}
