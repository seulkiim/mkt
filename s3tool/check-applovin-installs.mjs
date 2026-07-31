import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";

const BASE   = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS = ["com.albus.idolharvest", "id6756664337"];
const TARGET_DTS = ["dt=2026-07-06","dt=2026-07-07","dt=2026-07-08","dt=2026-07-09","dt=2026-07-10","dt=2026-07-11","dt=2026-07-12","dt=2026-07-13"];

function toKSTDate(ts) {
  if (!ts) return null;
  const d = typeof ts === "number" ? new Date(ts) : new Date(String(ts).includes("T")||String(ts).includes(" ")?ts:ts+"T00:00:00Z");
  return new Date(d.getTime()+9*3600000).toISOString().slice(0,10);
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

async function scanDts(tbl, dts, appFilter, wantCols) {
  const prefix = `${BASE}t=${tbl}/`;
  const all=[];
  for (const dt of dts) {
    const s1 = await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:`${prefix}${dt}/`,Delimiter:"/",MaxKeys:50}));
    for (const p1 of (s1.CommonPrefixes||[])) {
      const s2 = await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p1.Prefix,Delimiter:"/",MaxKeys:10}));
      for (const p2 of (s2.CommonPrefixes||[])) {
        const appId = p2.Prefix.match(/app_id=([^/]+)/)?.[1];
        if (appFilter && appId && !APP_IDS.includes(appId)) continue;
        const files = await listParquet(p2.Prefix);
        for (const f of files) {
          try { all.push(...(await readParquet(f, wantCols))); }
          catch(e) {}
        }
      }
    }
    process.stderr.write(`  ${tbl}/${dt} done\n`);
  }
  return all;
}

// ─────────────────────────────────────
// 1. 일반 installs: applovin 관련 미디어 소스 전체 확인
// ─────────────────────────────────────
process.stdout.write("\n=== [1] 일반 installs — applovin 관련 media_source ===\n");
const instRows = await scanDts("installs", TARGET_DTS, true, ["install_time","media_source","appsflyer_id","app_id"]);

const regByDate = {};
const msCount = {};
for (const r of instRows) {
  const ms = r.media_source || "organic";
  if (!ms.toLowerCase().includes("applovin") && ms !== "applovin_int") continue;
  const kd = toKSTDate(r.install_time);
  if (!kd) continue;
  msCount[ms] = (msCount[ms]||0)+1;
  regByDate[kd] = (regByDate[kd]||0)+1;
}
process.stdout.write("media_source 종류:\n");
Object.entries(msCount).sort((a,b)=>b[1]-a[1]).forEach(([m,c])=>process.stdout.write(`  ${m}: ${c}건\n`));
process.stdout.write("KST 날짜별 (일반):\n");
Object.entries(regByDate).sort().forEach(([d,c])=>process.stdout.write(`  ${d}: ${c}건\n`));

// ─────────────────────────────────────
// 2. skad_installs: applovin 관련 확인
// ─────────────────────────────────────
process.stdout.write("\n=== [2] skad_installs — applovin 관련 media_source ===\n");
const skadRows = await scanDts("skad_installs", TARGET_DTS, false, ["install_date","media_source","af_attribution_flag","app_id"]);

const skadByDate = {}; const skadFlagTrue = {}; const skadMs = {};
for (const r of skadRows) {
  const ms = r.media_source || "unknown";
  if (!ms.toLowerCase().includes("applovin") && ms !== "applovin_int") continue;
  const kd = r.install_date ? String(r.install_date).slice(0,10) : null;
  if (!kd) continue;
  const flag = String(r.af_attribution_flag).toLowerCase();
  skadMs[ms] = (skadMs[ms]||0)+1;
  if (flag === "true") {
    skadFlagTrue[kd] = (skadFlagTrue[kd]||0)+1;
  } else {
    skadByDate[kd] = (skadByDate[kd]||0)+1;
  }
}
process.stdout.write("media_source 종류:\n");
Object.entries(skadMs).sort((a,b)=>b[1]-a[1]).forEach(([m,c])=>process.stdout.write(`  ${m}: ${c}건\n`));
process.stdout.write("KST 날짜별 (SKAD, flag=false):\n");
Object.entries(skadByDate).sort().forEach(([d,c])=>process.stdout.write(`  ${d}: ${c}건\n`));
process.stdout.write("KST 날짜별 (SKAD, flag=true → 제외됨):\n");
Object.entries(skadFlagTrue).sort().forEach(([d,c])=>process.stdout.write(`  ${d}: ${c}건\n`));

// ─────────────────────────────────────
// 3. cost_etl_summary: applovin cost 확인
// ─────────────────────────────────────
process.stdout.write("\n=== [3] cost_etl_summary — applovin 비용 ===\n");
const costPrefix = `${BASE}t=cost_etl_summary/`;
const costDtR = await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:costPrefix,Delimiter:"/",MaxKeys:20}));
const costDates = (costDtR.CommonPrefixes||[]).map(p=>p.Prefix.replace(costPrefix,"").replace(/\/$/,"")).sort();

for (const dt of costDates) {
  const s1 = await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:`${costPrefix}${dt}/`,Delimiter:"/",MaxKeys:10}));
  for (const p1 of (s1.CommonPrefixes||[])) {
    const files = await listParquet(p1.Prefix);
    for (const f of files) {
      try {
        const rows = await readParquet(f, ["app_id","media_source","date","cost","impressions","clicks","installs"]);
        for (const r of rows) {
          if (!APP_IDS.includes(r.app_id)) continue;
          const ms = r.media_source||"";
          if (!ms.toLowerCase().includes("applovin") && ms !== "applovin_int") continue;
          const kd = r.date ? String(r.date).slice(0,10) : null;
          if (!kd) continue;
          process.stdout.write(`  ${kd} | ${ms} | cost=$${parseFloat(r.cost||0).toFixed(2)} impr=${r.impressions} clicks=${r.clicks} inst=${r.installs}\n`);
        }
      } catch(e) {}
    }
  }
}

process.stdout.write("\nDone.\n");
