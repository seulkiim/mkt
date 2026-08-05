import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET as bucket } from "./aws-client.mjs";
import { createWriteStream, mkdirSync } from "fs";
import { pipeline } from "stream/promises";
import { createGunzip } from "zlib";
import path from "path";
import { dataPath } from "./paths.mjs";


const prefix = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/t=inapps/";
const outputDir = dataPath("data");

mkdirSync(outputDir, { recursive: true });

// 1. inapps 폴더 내 파일 목록 조회
const listCmd = new ListObjectsV2Command({
  Bucket: bucket,
  Prefix: prefix,
  MaxKeys: 50,
});

const listResp = await client.send(listCmd);

// 폴더(날짜 파티션) 목록 출력
console.log("=== inapps 폴더 구조 ===");
listResp.CommonPrefixes?.forEach(p => console.log("📁", p.Prefix));
listResp.Contents?.forEach(o => console.log("📄", o.Key, `(${(o.Size/1024).toFixed(1)} KB)`));

// 2. 날짜별 파티션 재조회 (depth 더 깊이)
const listCmd2 = new ListObjectsV2Command({
  Bucket: bucket,
  Prefix: prefix,
  MaxKeys: 200,
});
const listResp2 = await client.send(listCmd2);

// 실제 파일만 필터 (0바이트 제외)
const files = listResp2.Contents?.filter(o => o.Size > 0) || [];

console.log(`\n=== 총 ${files.length}개 파일 발견 ===`);
files.slice(0, 10).forEach(f => console.log(`📄 ${f.Key} (${(f.Size/1024).toFixed(1)} KB)`));

if (files.length === 0) {
  console.log("파일이 없습니다. 날짜 파티션을 더 탐색합니다...");
  process.exit(0);
}

// 3. 첫 번째 파일 다운로드 및 압축 해제
const targetFile = files[0];
console.log(`\n다운로드 중: ${targetFile.Key}`);

const getCmd = new GetObjectCommand({ Bucket: bucket, Key: targetFile.Key });
const getResp = await client.send(getCmd);

const fileName = path.basename(targetFile.Key).replace(".gz", ".csv");
const outputPath = path.join(outputDir, fileName);

if (targetFile.Key.endsWith(".gz")) {
  await pipeline(getResp.Body, createGunzip(), createWriteStream(outputPath));
} else {
  await pipeline(getResp.Body, createWriteStream(outputPath));
}

console.log(`\n✅ 저장 완료: ${outputPath}`);
