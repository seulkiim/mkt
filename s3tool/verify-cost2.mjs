import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";

const BASE   = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS = ["com.albus.idolharvest", "id6756664337"];
const TARGET_KST = ["2026-07-07","2026-07-08","2026-07-09","2026-07-10","2026-07-11","2026-07-12","2026-07-13"];
const costPrefix = `${BASE}t=cost_etl_summary/`;

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

// dt= 목록
const dtR = await listAll(costPrefix, "/");
const dts = dtR.prefixes.map(p=>p.replace(costPrefix,"").replace(/\/$/,"").replace("dt=","")).sort();
process.stdout.write(`dt 파티션: ${dts.join(", ")}\n\n`);

// 각 dt= 의 최대 v= 폴더 찾기 + 그 안에서 우리 앱의 target date별 존재 여부
// 구조: date -> dt -> {cost, imp, clicks} (해당 dt의 max v에서, 우리 2앱 applovin_int 합산)
process.stdout.write("═══ 각 dt=의 max v= 에서 applovin_int, 우리앱 합산 (date별) ═══\n");

const grid = {}; // date -> dt -> {cost,imp}
for (const dt of dts) {
  // v= 폴더 목록
  const vs = (await listAll(`${costPrefix}dt=${dt}/`, "/")).prefixes
    .map(p=>({name:p.match(/v=(\d+)/)?.[1], prefix:p}))
    .filter(v=>v.name)
    .sort((a,b)=>parseInt(b.name)-parseInt(a.name));
  const maxV = vs[0];
  if (!maxV) continue;

  const files = (await listAll(maxV.prefix)).files;
  const acc = {}; // date -> {cost,imp,clicks}
  for (const f of files) {
    const rows = await readParquet(f, ["app_id","media_source","date","cost","impressions","clicks"]);
    for (const r of rows) {
      if (r.media_source !== "applovin_int") continue;
      if (!APP_IDS.includes(r.app_id)) continue;
      const d = String(r.date).slice(0,10);
      if (!TARGET_KST.includes(d)) continue;
      if (!acc[d]) acc[d] = {cost:0,imp:0,clicks:0};
      acc[d].cost += parseFloat(r.cost)||0;
      acc[d].imp  += parseFloat(r.impressions)||0;
      acc[d].clicks += parseFloat(r.clicks)||0;
    }
  }
  process.stdout.write(`\ndt=${dt} (max v=${maxV.name}):\n`);
  for (const d of TARGET_KST) {
    if (acc[d]) {
      process.stdout.write(`   ${d}: cost $${acc[d].cost.toFixed(2)}, imp ${acc[d].imp}, clk ${acc[d].clicks}\n`);
      if (!grid[d]) grid[d] = {};
      grid[d][dt] = acc[d];
    }
  }
}

// 각 date별 "가장 최신 dt=" 의 값이 최종 확정값
process.stdout.write("\n\n═══ 최종 확정값 (각 date를 포함하는 가장 최신 dt=의 max v=) ═══\n");
for (const d of TARGET_KST) {
  const availDts = Object.keys(grid[d]||{}).sort();
  const latest = availDts.at(-1);
  if (latest) {
    const v = grid[d][latest];
    process.stdout.write(`  ${d}: cost $${v.cost.toFixed(2)}, imp ${v.imp}, clk ${v.clicks}  (from dt=${latest})\n`);
  } else {
    process.stdout.write(`  ${d}: 데이터 없음\n`);
  }
}
process.stdout.write("\nDone.\n");
