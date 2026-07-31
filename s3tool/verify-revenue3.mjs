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
    for (const row of rawRows) { const obj={}; wantCols.forEach(c=>{const i=allCols.indexOf(c);obj[c]=i>=0?row[i]:null;}); rows.push(obj); }
  }});
  return rows;
}

// attributed_ad_revenue_v2 dt=2026-07-12: 전체 version 합산 vs 최신 version만
const prefix = `${BASE}t=attributed_ad_revenue_v2/dt=2026-07-12/`;
const versions = (await listAll(prefix, "/")).prefixes
  .map(p=>({v:parseInt(p.match(/version=(\d+)/)?.[1]??"-1"),prefix:p}))
  .filter(x=>x.v>=0).sort((a,b)=>a.v-b.v);

process.stdout.write(`═══ attributed_ad_revenue_v2 dt=2026-07-12 : version 폴더 ${versions.length}개 ═══\n\n`);

let allVersionsSum = 0, allVersionsCnt = 0;
const perVersion = [];
for (const {v, prefix: vp} of versions) {
  let sum=0, cnt=0;
  for (const appId of APP_IDS) {
    const files = (await listAll(`${vp}app_id=${appId}/`)).files;
    for (const f of files) {
      const rows = await readParquet(f, ["event_revenue_usd"]);
      for (const r of rows) { sum += parseFloat(r.event_revenue_usd)||0; cnt++; }
    }
  }
  perVersion.push({v, sum, cnt});
  allVersionsSum += sum; allVersionsCnt += cnt;
  process.stdout.write(`  version=${v}: 이벤트 ${cnt}건, 매출 $${sum.toFixed(2)}\n`);
}

const maxVer = perVersion.at(-1);
process.stdout.write(`\n  ─────────────────────────────\n`);
process.stdout.write(`  전체 version 합산 (현재 스크립트 방식): 이벤트 ${allVersionsCnt}건, 매출 $${allVersionsSum.toFixed(2)}\n`);
process.stdout.write(`  최신 version만 (올바른 방식):          이벤트 ${maxVer.cnt}건, 매출 $${maxVer.sum.toFixed(2)}\n`);
process.stdout.write(`  중복 배수: ${(allVersionsSum/maxVer.sum).toFixed(2)}배\n`);

process.stdout.write("\nDone.\n");
