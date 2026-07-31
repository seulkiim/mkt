import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";
const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP="id6756664337";
async function lp(p){const f=[];let t;do{const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,MaxKeys:1000,ContinuationToken:t}));for(const o of (r.Contents||[]))if(o.Size>0&&o.Key.endsWith(".parquet"))f.push(o.Key);t=r.NextContinuationToken;}while(t);return f;}
async function lpre(p){const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,Delimiter:"/",MaxKeys:1000}));return (r.CommonPrefixes||[]).map(x=>x.Prefix);}
async function allcols(key){const resp=await client.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));const ch=[];for await(const c of resp.Body)ch.push(c);const buf=Buffer.concat(ch);const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);return parquetMetadata(ab).schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);}
async function rpAll(key){const resp=await client.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));const ch=[];for await(const c of resp.Body)ch.push(c);const buf=Buffer.concat(ch);const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);const meta=parquetMetadata(ab);const cols=meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);const rows=[];await parquetRead({file:ab,onComplete:raw=>{for(const row of raw){const o={};cols.forEach((c,i)=>o[c]=row[i]);rows.push(o);}}});return {cols,rows};}

const dt=(await lpre(`${BASE}t=attributed_ad_revenue_v2/`)).map(p=>p.match(/dt=[^/]+/)[0]).sort().at(-3);
const vs=(await lpre(`${BASE}t=attributed_ad_revenue_v2/${dt}/`)).map(p=>({v:parseInt(p.match(/version=(\d+)/)?.[1]??"-1"),prefix:p})).filter(x=>x.v>=0).sort((a,b)=>b.v-a.v);
let f;for(const ff of await lp(`${vs[0].prefix}app_id=${APP}/`)){f=ff;break;}
const {cols,rows}=await rpAll(f);
console.log("attributed_ad_revenue_v2 전체 컬럼("+cols.length+"):");
console.log("  "+cols.join(", "));
// impression/count 관련 컬럼
const impCols=cols.filter(c=>/impress|count|event_counter|revenue|ad_type|ad_network|conversion/i.test(c));
console.log("\n노출/카운트/매출 관련 컬럼:", impCols.join(", "));
console.log("\n샘플 5행 (주요 필드):");
rows.slice(0,5).forEach(r=>{
  const o={};for(const c of ["event_name","event_time","install_time","event_revenue_usd","event_revenue","ad_revenue_ad_type","ad_network_name","event_counter","event_uuid","media_source"])if(r[c]!=null&&r[c]!=="")o[c]=String(r[c]);
  console.log("  "+JSON.stringify(o));
});
// event_name 분포 + 행당 매출 분포
const evn={};let n=0,sum=0;const revs=[];
for(const r of rows){evn[r.event_name]=(evn[r.event_name]||0)+1;const v=parseFloat(r.event_revenue_usd)||0;if(v>0){n++;sum+=v;revs.push(v);}}
revs.sort((a,b)=>a-b);
console.log("\nevent_name 분포:",JSON.stringify(evn));
console.log("행당 event_revenue_usd: 평균 $"+(sum/n).toFixed(4)+" 중앙값 $"+revs[Math.floor(revs.length/2)].toFixed(4)+" 최소 $"+revs[0].toFixed(5)+" 최대 $"+revs.at(-1).toFixed(4));
