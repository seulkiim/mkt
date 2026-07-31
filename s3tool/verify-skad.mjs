import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";

const BASE   = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS = ["com.albus.idolharvest", "id6756664337"];
const TARGET_KST = ["2026-07-07","2026-07-08","2026-07-09","2026-07-10","2026-07-11","2026-07-12","2026-07-13"];
const TARGET_DTS = ["dt=2026-07-06","dt=2026-07-07","dt=2026-07-08","dt=2026-07-09","dt=2026-07-10","dt=2026-07-11","dt=2026-07-12","dt=2026-07-13","dt=2026-07-14"];

async function listAll(prefix, delimiter) {
  const opts = { Bucket: BUCKET, Prefix: prefix, MaxKeys: 1000 };
  if (delimiter) opts.Delimiter = delimiter;
  const out = { prefixes: [], files: [] };
  let token;
  do {
    const r = await client.send(new ListObjectsV2Command({ ...opts, ContinuationToken: token }));
    for (const p of (r.CommonPrefixes||[])) out.prefixes.push(p.Prefix);
    for (const o of (r.Contents||[])) if (o.Size>0&&o.Key.endsWith(".parquet")) out.files.push(o.Key);
    token = r.NextContinuationToken;
  } while(token);
  return out;
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
    for (const row of rawRows) { const obj={}; (wantCols||allCols).forEach(c=>{const i=allCols.indexOf(c);obj[c]=i>=0?row[i]:null;}); rows.push(obj); }
  }});
  return {cols: allCols, rows};
}

// ══ STEP 1: skad_installs 파티션 구조 ══
process.stdout.write("═══ STEP 1: skad_installs 파티션 구조 ═══\n");
const prefix = `${BASE}t=skad_installs/`;
const dtR = await listAll(prefix, "/");
const dts = dtR.prefixes.map(p=>p.replace(prefix,"").replace(/\/$/,"")).sort();
process.stdout.write(`dt 파티션(${dts.length}): ${dts.join(", ")}\n`);

const lastDt = dts.at(-1);
const inner = await listAll(`${prefix}${lastDt}/`, "/");
process.stdout.write(`${lastDt} 하위 폴더: ${inner.prefixes.map(p=>p.replace(`${prefix}${lastDt}/`,"")).join(", ")}\n`);

// app_id 폴더 존재 여부 / version 존재 여부 확인 위해 2단계 더 파봄
if (inner.prefixes.length) {
  const l2 = await listAll(inner.prefixes[0], "/");
  process.stdout.write(`  → ${inner.prefixes[0].replace(prefix,"")} 하위: ${l2.prefixes.map(p=>p.split("/").slice(-2)[0]).join(", ") || "(파일 직접)"}\n`);
}

// 스키마 + install_date, af_attribution_flag 컬럼 확인
const oneFile = (await listAll(`${prefix}${lastDt}/`)).files[0];
if (oneFile) {
  const { cols, rows } = await readParquet(oneFile, null);
  process.stdout.write(`\n컬럼(${cols.length}): ${cols.filter(c=>c.includes("date")||c.includes("flag")||c.includes("media")||c.includes("attribution")||c==="app_id").join(", ")}\n`);
  // af_attribution_flag 고유값
  const flagVals = [...new Set(rows.map(r=>String(r.af_attribution_flag)))];
  process.stdout.write(`af_attribution_flag 고유값: ${flagVals.join(", ")}\n`);
  const appVals = [...new Set(rows.map(r=>String(r.app_id)))].slice(0,10);
  process.stdout.write(`app_id 고유값(샘플): ${appVals.join(", ")}\n`);
  process.stdout.write(`install_date 샘플: ${[...new Set(rows.map(r=>String(r.install_date).slice(0,10)))].slice(0,5).join(", ")}\n`);
}

process.stdout.write("\nDone STEP1.\n");
