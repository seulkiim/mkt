import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET as bucket } from "./aws-client.mjs";
import { parquetRead, parquetMetadata } from "hyparquet";
import { promisify } from "util";
import { gunzip } from "zlib";

const gunzipAsync = promisify(gunzip);


const APP_IDS = ["com.albus.idolharvest", "id6756664337"];

// 6월 Idol Farm Life inapps 파일 목록 조회
async function getJuneFiles() {
  const files = [];
  for (const appId of APP_IDS) {
    for (let day = 1; day <= 30; day++) {
      const dt = `2026-06-${String(day).padStart(2, "0")}`;
      const prefix = `c7yL-acc-m4k6c7yL-c7yL/wemadeplay/t=inapps/dt=${dt}/`;
      let ct = undefined;
      do {
        const resp = await client.send(new ListObjectsV2Command({
          Bucket: bucket, Prefix: prefix, MaxKeys: 100, ContinuationToken: ct
        }));
        (resp.Contents || [])
          .filter(o => o.Key.includes(`app_id=${appId}`) && o.Size > 0)
          .forEach(o => files.push({ key: o.Key, size: o.Size, appId, dt }));
        ct = resp.NextContinuationToken;
      } while (ct);
    }
  }
  return files;
}

// S3에서 파일 버퍼로 읽기
async function readS3File(key) {
  const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  for await (const chunk of resp.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Parquet 파일에서 af_purchase 행만 추출
async function extractPurchases(buffer) {
  const purchases = [];
  await parquetRead({
    file: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    onComplete: (rows) => {
      rows.forEach(row => {
        if (row.event_name === "af_purchase") {
          purchases.push(row);
        }
      });
    }
  });
  return purchases;
}

console.log("6월 Idol Farm Life 파일 목록 조회 중...");
const files = await getJuneFiles();
console.log(`총 ${files.length}개 파일 발견\n`);

if (files.length === 0) {
  console.log("파일이 없습니다.");
  process.exit(0);
}

// 첫 번째 파일로 컬럼 구조 확인
console.log(`첫 번째 파일 읽는 중: ${files[0].key}`);
const buf = await readS3File(files[0].key);
const purchases = await extractPurchases(buf);

if (purchases.length > 0) {
  console.log(`\n=== 컬럼 목록 ===`);
  console.log(Object.keys(purchases[0]).join(", "));
  console.log(`\n=== 첫 번째 구매 데이터 샘플 ===`);
  console.log(JSON.stringify(purchases[0], null, 2));
  console.log(`\n이 파일에서 af_purchase 이벤트: ${purchases.length}건`);
} else {
  console.log("이 파일에 af_purchase 이벤트가 없습니다.");
  // 다른 파일 시도
  for (const f of files.slice(1, 5)) {
    console.log(`시도: ${f.key}`);
    const b = await readS3File(f.key);
    const p = await extractPurchases(b);
    if (p.length > 0) {
      console.log(`\n=== 컬럼 목록 ===`);
      console.log(Object.keys(p[0]).join(", "));
      console.log(`\n=== 첫 번째 구매 데이터 샘플 ===`);
      console.log(JSON.stringify(p[0], null, 2));
      console.log(`\naf_purchase 이벤트: ${p.length}건`);
      break;
    }
  }
}
