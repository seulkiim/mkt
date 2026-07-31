import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";

const BASE   = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS = ["com.albus.idolharvest", "id6756664337"];

function toKSTDate(ts) {
  if (!ts) return null;
  const norm = String(ts).replace(" ","T") + (String(ts).includes("T")||String(ts).includes("+")?"":"Z");
  const d = typeof ts==="number"?new Date(ts):new Date(norm);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime()+9*3600000).toISOString().slice(0,10);
}
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

// ══ STEP 2A: attributed_ad_revenue_v2 dt=2026-07-13 의 version별 매출 (우리앱, event_time KST=7/12) ══
process.stdout.write("═══ STEP 2A: attributed_ad_revenue_v2 dt=2026-07-13 version별 (event KST=2026-07-12) ═══\n");
{
  const prefix = `${BASE}t=attributed_ad_revenue_v2/dt=2026-07-13/`;
  const versions = (await listAll(prefix, "/")).prefixes;
  for (const vf of versions) {
    const vName = vf.match(/version=(\d+)/)?.[1];
    let sum = 0, cnt = 0;
    for (const appId of APP_IDS) {
      const files = (await listAll(`${vf}app_id=${appId}/`)).files;
      for (const f of files) {
        const rows = await readParquet(f, ["event_time","event_revenue_usd","event_name"]);
        for (const r of rows) {
          if (toKSTDate(r.event_time) !== "2026-07-12") continue;
          const rev = parseFloat(r.event_revenue_usd)||0;
          sum += rev; cnt++;
        }
      }
    }
    process.stdout.write(`  version=${vName}: 이벤트 ${cnt}건, 매출 $${sum.toFixed(2)}\n`);
  }
}

// ══ STEP 2B: 같은 event KST 날짜(7/12)를 여러 dt= 파티션에서 (누적 스냅샷 여부) — 각 dt의 최신 version만 ══
process.stdout.write("\n═══ STEP 2B: attributed_ad_revenue_v2 event KST=7/12 를 각 dt=의 최신 version에서 ═══\n");
{
  const base = `${BASE}t=attributed_ad_revenue_v2/`;
  const dts = (await listAll(base,"/")).prefixes.map(p=>p.replace(base,"").replace(/\/$/,"").replace("dt=","")).sort();
  for (const dt of dts) {
    if (dt < "2026-07-12") continue;
    const versions = (await listAll(`${base}dt=${dt}/`,"/")).prefixes
      .map(p=>({v:parseInt(p.match(/version=(\d+)/)?.[1]??"-1"),prefix:p}))
      .filter(x=>x.v>=0).sort((a,b)=>b.v-a.v);
    const maxV = versions[0];
    if (!maxV) continue;
    let sum=0,cnt=0;
    for (const appId of APP_IDS) {
      const files = (await listAll(`${maxV.prefix}app_id=${appId}/`)).files;
      for (const f of files) {
        const rows = await readParquet(f, ["event_time","event_revenue_usd"]);
        for (const r of rows) {
          if (toKSTDate(r.event_time)!=="2026-07-12") continue;
          sum += parseFloat(r.event_revenue_usd)||0; cnt++;
        }
      }
    }
    process.stdout.write(`  dt=${dt} (maxVer=${maxV.v}): 7/12 이벤트 ${cnt}건, 매출 $${sum.toFixed(2)}\n`);
  }
}

// ══ STEP 2C: inapps(IAP) af_purchase 가 dt= 파티션 간 중복되는지 ══
// event KST=7/12 인 af_purchase 를 각 dt= 파티션에서 카운트
process.stdout.write("\n═══ STEP 2C: inapps af_purchase (event KST=7/12) 를 각 dt= 파티션에서 ═══\n");
{
  const base = `${BASE}t=inapps/`;
  const dts = (await listAll(base,"/")).prefixes.map(p=>p.replace(base,"").replace(/\/$/,"").replace("dt=","")).sort();
  let grandTotal = 0, grandCnt = 0;
  for (const dt of dts) {
    if (dt < "2026-07-12" || dt > "2026-07-14") continue;
    let sum=0,cnt=0;
    const hFolders = (await listAll(`${base}dt=${dt}/`,"/")).prefixes; // h=0.. etc
    for (const hf of hFolders) {
      for (const appId of APP_IDS) {
        const files = (await listAll(`${hf}app_id=${appId}/`)).files;
        for (const f of files) {
          const rows = await readParquet(f, ["event_time","event_name","event_revenue_usd"]);
          for (const r of rows) {
            if (r.event_name!=="af_purchase") continue;
            if (toKSTDate(r.event_time)!=="2026-07-12") continue;
            const rev = parseFloat(r.event_revenue_usd)||0;
            if (rev<=0) continue;
            sum += rev; cnt++;
          }
        }
      }
    }
    process.stdout.write(`  dt=${dt}: 7/12 af_purchase ${cnt}건, 매출 $${sum.toFixed(2)}\n`);
    grandTotal += sum; grandCnt += cnt;
  }
  process.stdout.write(`  → 만약 이벤트가 각 dt에 한 번만 있으면 합산해도 되지만, 중복이면 한 dt만 써야 함\n`);
}

process.stdout.write("\nDone.\n");
