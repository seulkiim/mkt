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
    for (const o of (r.Contents||[])) if (o.Size>0) out.files.push({key:o.Key, size:o.Size});
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
    for (const row of rawRows) {
      const obj={};
      (wantCols||allCols).forEach(c=>{ const i=allCols.indexOf(c); obj[c]=i>=0?row[i]:null; });
      rows.push(obj);
    }
  }});
  return {cols: allCols, rows};
}

// ═══════════════════════════════════════════
// STEP 1: cost_etl_summary 파티션 구조 확인
// ═══════════════════════════════════════════
const costPrefix = `${BASE}t=cost_etl_summary/`;
process.stdout.write("═══ STEP 1: cost_etl_summary dt= 파티션 목록 ═══\n");
const dtR = await listAll(costPrefix, "/");
const dts = dtR.prefixes.map(p=>p.replace(costPrefix,"").replace(/\/$/,"")).sort();
process.stdout.write(`dt 파티션: ${dts.join(", ")}\n\n`);

// ═══════════════════════════════════════════
// STEP 2: 한 dt= 파티션의 내부 구조 (app_id 분할 여부)
// ═══════════════════════════════════════════
const sampleDt = dts.at(-1);
process.stdout.write(`═══ STEP 2: ${sampleDt} 내부 구조 ═══\n`);
const inner = await listAll(`${costPrefix}${sampleDt}/`, "/");
process.stdout.write(`하위 폴더(CommonPrefixes): ${inner.prefixes.length}개\n`);
inner.prefixes.slice(0,10).forEach(p=>process.stdout.write(`  ${p.replace(costPrefix,"")}\n`));
process.stdout.write(`직속 파일: ${inner.files.length}개\n`);
inner.files.slice(0,5).forEach(f=>process.stdout.write(`  ${f.key.replace(costPrefix,"")} (${f.size}b)\n`));
process.stdout.write("\n");

// ═══════════════════════════════════════════
// STEP 3: 전체 파일 재귀 나열 (한 dt 내)
// ═══════════════════════════════════════════
process.stdout.write(`═══ STEP 3: ${sampleDt} 하위 전체 parquet 파일 ═══\n`);
const allFiles = await listAll(`${costPrefix}${sampleDt}/`);
const pq = allFiles.files.filter(f=>f.key.endsWith(".parquet"));
process.stdout.write(`parquet 파일 ${pq.length}개:\n`);
pq.forEach(f=>process.stdout.write(`  ${f.key.replace(`${costPrefix}${sampleDt}/`,"")} (${f.size}b)\n`));
process.stdout.write("\n");

// ═══════════════════════════════════════════
// STEP 4: 스키마 + 샘플 데이터 (app_id 컬럼 존재 여부, date 형식)
// ═══════════════════════════════════════════
process.stdout.write(`═══ STEP 4: 스키마 + 샘플 행 ═══\n`);
if (pq.length) {
  const { cols, rows } = await readParquet(pq[0].key);
  process.stdout.write(`컬럼(${cols.length}): ${cols.join(", ")}\n\n`);
  process.stdout.write(`전체 행수: ${rows.length}\n`);
  process.stdout.write(`샘플 5행:\n`);
  rows.slice(0,5).forEach(r=>{
    const o={}; Object.entries(r).forEach(([k,v])=>{ if(v!=null&&v!=="") o[k]=String(v); });
    process.stdout.write(`  ${JSON.stringify(o)}\n`);
  });

  // date 컬럼 고유값
  const dateCol = cols.find(c=>c==="date") ? "date" : cols.find(c=>c.includes("date"));
  if (dateCol) {
    const uniqDates = [...new Set(rows.map(r=>String(r[dateCol]).slice(0,10)))].sort();
    process.stdout.write(`\n${dateCol} 고유값: ${uniqDates.join(", ")}\n`);
  }
  // app_id 컬럼 고유값
  if (cols.includes("app_id")) {
    const uniqApps = [...new Set(rows.map(r=>r.app_id))];
    process.stdout.write(`app_id 고유값: ${uniqApps.join(", ")}\n`);
  }
  // media_source 고유값
  if (cols.includes("media_source")) {
    const uniqMs = [...new Set(rows.map(r=>r.media_source))];
    process.stdout.write(`media_source 고유값(${uniqMs.length}): ${uniqMs.slice(0,20).join(", ")}\n`);
  }
}
process.stdout.write("\n");

// ═══════════════════════════════════════════
// STEP 5: 여러 dt= 에서 같은 (date, media, app_id) 조합이 반복되는지 = 누적 스냅샷 검증
// applovin, date=2026-07-09 를 각 dt= 파티션에서 추출
// ═══════════════════════════════════════════
process.stdout.write(`═══ STEP 5: 누적 스냅샷 + v= 버전 검증 (applovin, date=2026-07-09) ═══\n`);
for (const dt of dts) {
  // v= 폴더별로 분리해서 검증
  const vFolders = (await listAll(`${costPrefix}${dt}/`, "/")).prefixes;
  for (const vf of vFolders) {
    const vName = vf.match(/v=\d+/)?.[0] || vf;
    const files = (await listAll(vf)).files.filter(f=>f.key.endsWith(".parquet"));
    let sum = 0, rowsFound = 0, impSum = 0;
    for (const f of files) {
      const { rows } = await readParquet(f.key, ["app_id","media_source","date","geo","cost","impressions","clicks","installs"]);
      for (const r of rows) {
        if (r.media_source !== "applovin_int") continue;
        const kd = String(r.date).slice(0,10);
        if (kd !== "2026-07-09") continue;
        if (r.app_id && !APP_IDS.includes(r.app_id)) continue;
        sum += parseFloat(r.cost)||0;
        impSum += parseFloat(r.impressions)||0;
        rowsFound++;
      }
    }
    process.stdout.write(`  dt=${dt} ${vName}: applovin 7/9 → 행 ${rowsFound}개, cost $${sum.toFixed(2)}, imp ${impSum}\n`);
  }
}

process.stdout.write("\nDone.\n");
