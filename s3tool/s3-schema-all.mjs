import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata } from "hyparquet";

const BASE   = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";

// ── 1. 테이블 목록 ──
const topResp = await client.send(new ListObjectsV2Command({
  Bucket: BUCKET, Prefix: BASE, Delimiter: "/"
}));
const tables = (topResp.CommonPrefixes || []).map(p => ({
  name: p.Prefix.replace(BASE, "").replace(/\/$/, ""),
  prefix: p.Prefix
}));

console.log(`\n${"=".repeat(60)}`);
console.log(` S3 Data Locker — 전체 디렉토리 & 스키마`);
console.log(` Bucket: ${BUCKET}`);
console.log(`${"=".repeat(60)}\n`);

const result = [];

for (const tbl of tables) {
  process.stderr.write(`\r스캔 중: ${tbl.name}                    `);

  // ── 날짜 목록 ──
  const dtResp = await client.send(new ListObjectsV2Command({
    Bucket: BUCKET, Prefix: tbl.prefix, Delimiter: "/", MaxKeys: 100
  }));
  const dates = (dtResp.CommonPrefixes || []).map(p =>
    p.Prefix.replace(tbl.prefix, "").replace(/\/$/, "")
  );

  // ── 앱 ID 샘플 탐색 (최신 날짜 기준) ──
  let sampleFile = null;
  let appIds = new Set();
  let hours = [];

  if (dates.length > 0) {
    const latestDt = dates.sort().at(-1);
    const hResp = await client.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: `${tbl.prefix}${latestDt}/`, Delimiter: "/", MaxKeys: 100
    }));
    hours = (hResp.CommonPrefixes || []).map(p =>
      p.Prefix.replace(`${tbl.prefix}${latestDt}/`, "").replace(/\/$/, "")
    );

    // 파일 1개 탐색
    outer: for (const h of hours.sort().slice(0, 5)) {
      const appResp = await client.send(new ListObjectsV2Command({
        Bucket: BUCKET, Prefix: `${tbl.prefix}${latestDt}/${h}/`, Delimiter: "/", MaxKeys: 20
      }));
      for (const ap of (appResp.CommonPrefixes || [])) {
        const apId = ap.Prefix.replace(`${tbl.prefix}${latestDt}/${h}/`, "").replace(/\/$/, "").replace("app_id=", "");
        appIds.add(apId);
        const fResp = await client.send(new ListObjectsV2Command({
          Bucket: BUCKET, Prefix: ap.Prefix, MaxKeys: 5
        }));
        const f = (fResp.Contents || []).find(o => o.Size > 0 && o.Key.endsWith(".parquet"));
        if (f) { sampleFile = { key: f.Key, size: f.Size }; break outer; }
      }
    }
  }

  // ── 스키마 읽기 ──
  let cols = [];
  if (sampleFile) {
    try {
      const resp = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: sampleFile.key }));
      const chunks = []; for await (const c of resp.Body) chunks.push(c);
      const buf = Buffer.concat(chunks);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const meta = parquetMetadata(ab);
      cols = meta.schema.filter(s => s.name && s.name !== "spark_schema").map(s => s.name);
    } catch(e) { cols = [`[읽기 오류: ${e.message.slice(0,40)}]`]; }
  }

  result.push({ name: tbl.name, dates, hours, appIds: [...appIds], sampleFile, cols });
}

process.stderr.write("\r완료                                           \n");

// ── 출력 ──
result.forEach(t => {
  const dtRange = t.dates.length
    ? `${t.dates.sort()[0]} ~ ${t.dates.sort().at(-1)} (${t.dates.length}일)`
    : "날짜 없음";
  const hRange  = t.hours.length
    ? `h=${t.hours.sort()[0]} ~ h=${t.hours.sort().at(-1)}`
    : "-";
  console.log(`┌─ ${t.name}`);
  console.log(`│  날짜 범위: ${dtRange}`);
  console.log(`│  시간 파티션: ${hRange}`);
  console.log(`│  앱 ID: ${t.appIds.join(", ") || "-"}`);
  if (t.sampleFile) {
    console.log(`│  샘플 파일: ${t.sampleFile.key.split("/").at(-1)} (${(t.sampleFile.size/1024).toFixed(0)} KB)`);
  }
  if (t.cols.length) {
    console.log(`│  컬럼 (${t.cols.length}개): ${t.cols.join(", ")}`);
  } else {
    console.log(`│  컬럼: 파일 없음`);
  }
  console.log(`└${"─".repeat(58)}`);
});

console.log(`\n총 ${result.length}개 테이블`);
