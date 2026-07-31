import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";

const BASE   = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS = ["com.albus.idolharvest", "id6756664337"];

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

// ══ STEP 1: 각 revenue 테이블의 파티션 구조 확인 ══
for (const tbl of ["inapps","attributed_ad_revenue_v2","organic_ad_revenue_v2","retargeting_ad_revenue_v2"]) {
  const prefix = `${BASE}t=${tbl}/`;
  const dtR = await listAll(prefix, "/");
  const dts = dtR.prefixes.map(p=>p.replace(prefix,"").replace(/\/$/,"")).sort();
  process.stdout.write(`\n═══ ${tbl} ═══\n`);
  process.stdout.write(`dt 파티션(${dts.length}): ${dts.join(", ")}\n`);

  // 최신 dt의 내부 구조
  const lastDt = dts.at(-1);
  if (!lastDt) continue;
  const inner = await listAll(`${prefix}${lastDt}/`, "/");
  process.stdout.write(`${lastDt} 하위 폴더: ${inner.prefixes.map(p=>p.replace(`${prefix}${lastDt}/`,"")).slice(0,8).join(", ")}\n`);

  // 스키마 + event_time 관련 컬럼 확인
  const oneFile = (await listAll(`${prefix}${lastDt}/`)).files[0];
  if (oneFile) {
    const { cols } = await readParquet(oneFile, null);
    const timeCols = cols.filter(c=>c.includes("time")||c.includes("date"));
    const revCols  = cols.filter(c=>c.includes("revenue")||c.includes("event_name"));
    process.stdout.write(`시간 관련 컬럼: ${timeCols.join(", ")}\n`);
    process.stdout.write(`매출 관련 컬럼: ${revCols.join(", ")}\n`);
  }
}

process.stdout.write("\nDone STEP1.\n");
