import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";

const BASE   = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS = ["com.albus.idolharvest", "id6756664337"];

const TARGET_DTS = [
  "dt=2026-07-06","dt=2026-07-07","dt=2026-07-08","dt=2026-07-09",
  "dt=2026-07-10","dt=2026-07-11","dt=2026-07-12","dt=2026-07-13"
];

// install_time은 UTC 기준 문자열 "YYYY-MM-DD HH:MM:SS" → KST 날짜 변환
function toKSTDate(ts) {
  if (!ts) return null;
  // 공백을 T로 바꿔 ISO8601로 처리, UTC 명시
  const normalized = String(ts).replace(" ", "T") + (String(ts).includes("T") || String(ts).includes("+") ? "" : "Z");
  const d = typeof ts === "number" ? new Date(ts) : new Date(normalized);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 9*3600000).toISOString().slice(0,10);
}

async function listParquet(prefix) {
  const files=[]; let token;
  do {
    const r = await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:prefix,MaxKeys:1000,ContinuationToken:token}));
    for (const o of (r.Contents||[])) if (o.Size>0&&o.Key.endsWith(".parquet")) files.push(o.Key);
    token = r.NextContinuationToken;
  } while(token);
  return files;
}

async function readParquet(key, wantCols) {
  const resp = await client.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));
  const chunks=[]; for await (const c of resp.Body) chunks.push(c);
  const buf=Buffer.concat(chunks);
  const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
  const meta=parquetMetadata(ab);
  const allCols=meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);
  const rows=[];
  await parquetRead({file:ab, onComplete: rawRows => {
    for (const row of rawRows) {
      const obj={};
      wantCols.forEach(c=>{ const i=allCols.indexOf(c); obj[c]=i>=0?row[i]:null; });
      rows.push(obj);
    }
  }});
  return rows;
}

// date(KST) × media 집계
const byDateMedia = {};
const dtStats = {};

for (const dt of TARGET_DTS) {
  let dtFiles=0, dtRows=0;
  const prefix = `${BASE}t=installs/`;
  const s1 = await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:`${prefix}${dt}/`,Delimiter:"/",MaxKeys:50}));
  for (const p1 of (s1.CommonPrefixes||[])) {
    const s2 = await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p1.Prefix,Delimiter:"/",MaxKeys:20}));
    for (const p2 of (s2.CommonPrefixes||[])) {
      // app_id는 path에서 필터링 (parquet 컬럼에는 없음)
      const appId = p2.Prefix.match(/app_id=([^/]+)/)?.[1];
      if (appId && !APP_IDS.includes(appId)) continue;
      const files = await listParquet(p2.Prefix);
      dtFiles += files.length;
      for (const f of files) {
        try {
          const rows = await readParquet(f, ["install_time","media_source","appsflyer_id"]);
          dtRows += rows.length;
          for (const r of rows) {
            const kd = toKSTDate(r.install_time);
            if (!kd) continue;
            const ms = r.media_source || "organic";
            if (!byDateMedia[kd]) byDateMedia[kd] = {};
            byDateMedia[kd][ms] = (byDateMedia[kd][ms]||0)+1;
          }
        } catch(e) { process.stderr.write(`err: ${e.message.slice(0,60)}\n`); }
      }
    }
  }
  dtStats[dt] = {files:dtFiles, rows:dtRows};
  process.stderr.write(`${dt} done (files:${dtFiles} rows:${dtRows})\n`);
}

// dt= 통계
process.stdout.write("\n=== dt= 파티션별 대상 앱 파일/행수 ===\n");
for (const [dt,s] of Object.entries(dtStats)) {
  process.stdout.write(`  ${dt}: 파일 ${s.files}개, 행 ${s.rows}건\n`);
}

// KST 날짜 × 매체 테이블
const dates = Object.keys(byDateMedia).sort();
process.stdout.write("\n=== KST 날짜별 × 매체별 일반 설치수 (t=installs) ===\n");
process.stdout.write(`${"날짜".padEnd(12)}${"Google".padStart(8)}${"Facebook".padStart(10)}${"Applovin".padStart(10)}${"Liftoff".padStart(9)}${"Organic".padStart(9)}${"기타".padStart(7)}${"합계".padStart(7)}\n`);
process.stdout.write("-".repeat(68)+"\n");

for (const d of dates) {
  const m = byDateMedia[d]||{};
  const g  = m["googleadwords_int"]||0;
  const fb = m["Facebook Ads"]||0;
  const ap = m["applovin_int"]||0;
  const lf = m["liftoff_int"]||0;
  const og = m["organic"]||0;
  const total = Object.values(m).reduce((a,b)=>a+b,0);
  const other = total - g - fb - ap - lf - og;
  process.stdout.write(`${d.padEnd(12)}${String(g).padStart(8)}${String(fb).padStart(10)}${String(ap).padStart(10)}${String(lf).padStart(9)}${String(og).padStart(9)}${String(other).padStart(7)}${String(total).padStart(7)}\n`);
}

// 기타 매체
const allMedia = new Set(Object.values(byDateMedia).flatMap(m=>Object.keys(m)));
const known = new Set(["googleadwords_int","Facebook Ads","applovin_int","liftoff_int","organic"]);
const others = [...allMedia].filter(m=>!known.has(m)).sort();
if (others.length) {
  process.stdout.write("\n=== 기타 media_source ===\n");
  for (const ms of others) {
    const total = dates.reduce((a,d)=>a+((byDateMedia[d]||{})[ms]||0),0);
    process.stdout.write(`  ${ms}: ${total}건 | 일별: ${dates.filter(d=>d>="2026-07-07").map(d=>`${d.slice(5)}=${(byDateMedia[d]||{})[ms]||0}`).join(" ")}\n`);
  }
}
process.stdout.write("\nDone.\n");
