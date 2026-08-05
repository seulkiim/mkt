import { readFileSync, writeFileSync } from "fs";
import { dataPath } from "./paths.mjs";
const ROWS = JSON.parse(readFileSync(dataPath("geo-cohort-os-result.json"),"utf8"));
const OUT = "C:/Users/STZ940/AppData/Local/Temp/claude/C--Users-STZ940-Documents-GitHub-mkt-report/899eecf2-8a64-43ee-88a7-a363205d50ef/scratchpad/geo-cohort-table.html";

const html = `<title>Performance Table — Idol Farm Life · 7/7–7/13 KST</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0D1117;--surf:#161B22;--surf2:#1C2128;--border:#21262D;--border2:#30363D;
  --txt:#E6EDF3;--muted:#8B949E;--dim:#484F58;
  --google:#4E9EFF;--facebook:#FF6B35;--applovin:#C084FC;--liftoff:#34D399;--organic:#7D8590;
  --good:#3FB950;--warn:#D29922;--bad:#F85149;--accent:#4E9EFF;
}
body{background:var(--bg);color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;font-size:13px;min-height:100vh;}
.hdr{background:var(--surf);border-bottom:1px solid var(--border);padding:13px 18px;}
.hdr-title{font-size:15px;font-weight:700;}
.hdr-sub{font-size:11.5px;color:var(--muted);margin-top:2px;}
.main{padding:14px 18px 48px;}
.ctrl{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px;}
.fg{display:flex;flex-direction:column;gap:3px;}
.fg label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;}
select{background:var(--surf);border:1px solid var(--border2);color:var(--txt);border-radius:4px;padding:5px 8px;font-size:12.5px;min-width:120px;}
.gb{border-color:var(--accent);}
.rowcount{font-size:11.5px;color:var(--muted);margin-left:auto;align-self:center;}
.reset{background:var(--surf);border:1px solid var(--border2);color:var(--muted);border-radius:4px;padding:5px 10px;font-size:11.5px;cursor:pointer;}
.reset:hover{color:var(--txt);}
.tw{overflow-x:auto;border:1px solid var(--border);border-radius:6px;max-height:74vh;}
table{border-collapse:collapse;width:100%;font-size:12px;}
th,td{padding:6px 9px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--border);font-variant-numeric:tabular-nums;}
th{background:var(--surf2);color:var(--muted);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.03em;position:sticky;top:0;cursor:pointer;user-select:none;z-index:2;}
th:hover{color:var(--txt);}
th.sorted{color:var(--accent);}
th .ar{font-size:8px;margin-left:2px;}
td.left,th.left{text-align:left;}
tbody tr:hover{background:var(--surf);}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;}
.os-pill{display:inline-block;font-size:10px;padding:1px 6px;border-radius:10px;border:1px solid var(--border2);}
.os-iOS{color:#7dd3fc;}.os-Android{color:#86efac;}
tfoot td{position:sticky;bottom:0;background:var(--surf2);font-weight:700;border-top:2px solid var(--border2);color:var(--txt);}
.na{color:var(--dim);}
.pos{color:var(--good);}.mid{color:var(--warn);}
.note{margin-top:12px;font-size:11px;color:var(--muted);background:var(--surf);border:1px solid var(--border);border-left:3px solid var(--warn);border-radius:4px;padding:9px 12px;line-height:1.6;}
</style>

<div class="hdr">
  <div class="hdr-title">📊 통합 성과 테이블 — Idol Farm Life</div>
  <div class="hdr-sub">2026/07/07 ~ 07/13 KST · 그룹 기준별 합계 · 지표: Cost / Install / CPI / D1·D3 ROAS / D1·D3 누적매출 · 설치일(코호트) 기준 · Cost 내림차순</div>
</div>
<div class="main">
  <div class="ctrl">
    <div class="fg"><label>그룹 기준 (합계 단위)</label><select id="groupby" class="gb"></select></div>
    <div class="fg"><label>매체 필터</label><select id="f-media"></select></div>
    <div class="fg"><label>국가 필터</label><select id="f-country"></select></div>
    <div class="fg"><label>OS 필터</label><select id="f-os"></select></div>
    <div class="fg"><label>설치일 필터</label><select id="f-date"></select></div>
    <button class="reset" onclick="resetF()">필터 초기화</button>
    <span class="rowcount" id="rowcount"></span>
  </div>
  <div class="tw"><table id="tbl"></table></div>
  <div class="note">
    <b>그룹 기준</b>을 바꾸면 해당 차원별로 <b>합계(sum) 행</b>이 만들어지고 Cost 내림차순으로 정렬됩니다. (예: "매체" → 매체별 합계 5행, "매체 × 국가" → 조합별 합계)
    모든 지표는 <b>설치일(코호트) 기준</b>. CPI=ΣCost/ΣInstall, D1 ROAS=Σ(D0~D1매출)/ΣCost, D3 ROAS=Σ(D0~D3매출)/ΣCost (합계 기반 재계산).
    Install Total=일반+SKAN(af_attribution_flag≠true), 매출=IAP+IAA. OS=Android/iOS(app_id), 국가=country_code.
    ⚠️ 7/12 코호트 D3·7/13 코호트 D1/D3는 이벤트가 아직 도착 중이라 과소 집계될 수 있음(IAA는 dt=2026-07-14까지).
  </div>
</div>

<script>
const RAW = ${JSON.stringify(ROWS)};
const MLABEL={"googleadwords_int":"Google","Facebook Ads":"Facebook","applovin_int":"Applovin","liftoff_int":"Liftoff","organic":"Organic"};
const MCOLOR={"googleadwords_int":"var(--google)","Facebook Ads":"var(--facebook)","applovin_int":"var(--applovin)","liftoff_int":"var(--liftoff)","organic":"var(--organic)"};
const MORDER=["googleadwords_int","Facebook Ads","applovin_int","liftoff_int","organic"];
const DIMS={media:"매체",country:"국가",os:"OS",date:"설치일"};
const GROUPBYS=[
  {id:"media",keys:["media"],label:"매체"},
  {id:"country",keys:["country"],label:"국가"},
  {id:"os",keys:["os"],label:"OS"},
  {id:"date",keys:["date"],label:"설치일"},
  {id:"media_os",keys:["media","os"],label:"매체 × OS"},
  {id:"media_country",keys:["media","country"],label:"매체 × 국가"},
  {id:"media_date",keys:["media","date"],label:"매체 × 설치일"},
  {id:"detail",keys:["media","country","os","date"],label:"상세 (매체×국가×OS×설치일)"},
];
const METRICS=[
  {k:"cost",label:"Cost",type:"$",best:"min"},
  {k:"install_total",label:"Install Total",type:"n",best:"max"},
  {k:"install_reg",label:"Regular",type:"n",best:"max"},
  {k:"install_skan",label:"SKAN",type:"n",best:"max"},
  {k:"cpi",label:"CPI",type:"$",best:"min"},
  {k:"roas_d1",label:"D1 ROAS",type:"%",best:"max"},
  {k:"roas_d3",label:"D3 ROAS",type:"%",best:"max"},
  {k:"rev_d1",label:"D1 매출",type:"$",best:"max"},
  {k:"rev_d3",label:"D3 매출",type:"$",best:"max"},
];
let groupbyId="media", sortKey="cost", sortDir=-1;

const f=id=>document.getElementById(id).value;
function uniq(key){const s=[...new Set(RAW.map(r=>r[key]))];
  if(key==="media")return s.sort((a,b)=>MORDER.indexOf(a)-MORDER.indexOf(b));
  if(key==="country"){const rev={};for(const r of RAW)rev[r.country]=(rev[r.country]||0)+r.cost;return s.sort((a,b)=>(rev[b]||0)-(rev[a]||0));}
  return s.sort();
}
function fillSel(id,key){const el=document.getElementById(id);el.innerHTML=\`<option value="__ALL__">전체</option>\`+uniq(key).map(v=>\`<option value="\${v}">\${key==="media"?(MLABEL[v]||v):v}</option>\`).join("");el.onchange=render;}
function fmt(v,t){if(v==null)return '<span class="na">–</span>';if(t==="$")return "$"+v.toLocaleString(undefined,{maximumFractionDigits:2});if(t==="%")return v.toFixed(1)+"%";if(t==="n")return v.toLocaleString();return v;}
function filtered(){
  const fm=f("f-media"),fc=f("f-country"),fo=f("f-os"),fd=f("f-date");
  return RAW.filter(r=>(fm==="__ALL__"||r.media===fm)&&(fc==="__ALL__"||r.country===fc)&&(fo==="__ALL__"||r.os===fo)&&(fd==="__ALL__"||r.date===fd));
}
function aggregate(rows,keys){
  const m={};
  for(const r of rows){
    const gk=keys.map(k=>r[k]).join("|||");
    if(!m[gk]){m[gk]={_k:{}};keys.forEach(k=>m[gk]._k[k]=r[k]);Object.assign(m[gk],{cost:0,install_total:0,install_reg:0,install_skan:0,rev_d1:0,rev_d3:0});}
    const e=m[gk];e.cost+=r.cost;e.install_total+=r.install_total;e.install_reg+=r.install_reg;e.install_skan+=r.install_skan;e.rev_d1+=r.rev_d1;e.rev_d3+=r.rev_d3;
  }
  for(const e of Object.values(m)){e.cpi=e.install_total>0?e.cost/e.install_total:null;e.roas_d1=e.cost>0&&e.rev_d1>0?e.rev_d1/e.cost*100:null;e.roas_d3=e.cost>0&&e.rev_d3>0?e.rev_d3/e.cost*100:null;}
  return Object.values(m);
}
function dimCell(k,v){
  if(k==="media")return \`<td class="left"><span class="dot" style="background:\${MCOLOR[v]||'var(--organic)'}"></span>\${MLABEL[v]||v}</td>\`;
  if(k==="os")return \`<td class="left"><span class="os-pill os-\${v}">\${v}</span></td>\`;
  if(k==="date")return \`<td class="left">\${String(v).slice(5)}</td>\`;
  return \`<td class="left">\${v}</td>\`;
}
function render(){
  const gb=GROUPBYS.find(g=>g.id===groupbyId);
  let rows=aggregate(filtered(),gb.keys);
  // 정렬
  rows.sort((a,b)=>{
    let x,y;
    if(gb.keys.includes(sortKey)){x=a._k[sortKey];y=b._k[sortKey];if(sortKey==="media"){x=MORDER.indexOf(x);y=MORDER.indexOf(y);}}
    else{x=a[sortKey];y=b[sortKey];}
    if(x==null)x=sortDir===1?Infinity:-Infinity;if(y==null)y=sortDir===1?Infinity:-Infinity;
    if(typeof x==="string")return sortDir*x.localeCompare(y);
    return sortDir*(x-y);
  });
  const T={cost:0,install_total:0,install_reg:0,install_skan:0,rev_d1:0,rev_d3:0};
  for(const r of rows){T.cost+=r.cost;T.install_total+=r.install_total;T.install_reg+=r.install_reg;T.install_skan+=r.install_skan;T.rev_d1+=r.rev_d1;T.rev_d3+=r.rev_d3;}
  const Tcpi=T.install_total>0?T.cost/T.install_total:null,Td1=T.cost>0?T.rev_d1/T.cost*100:null,Td3=T.cost>0?T.rev_d3/T.cost*100:null;

  // 헤더
  let h='<thead><tr>';
  for(const k of gb.keys){const s=k===sortKey;h+=\`<th class="left \${s?'sorted':''}" onclick="setSort('\${k}')">\${DIMS[k]}\${s?\`<span class="ar">\${sortDir===1?'▲':'▼'}</span>\`:''}</th>\`;}
  for(const m of METRICS){const s=m.k===sortKey;h+=\`<th class="\${s?'sorted':''}" onclick="setSort('\${m.k}')">\${m.label}\${s?\`<span class="ar">\${sortDir===1?'▲':'▼'}</span>\`:''}</th>\`;}
  h+='</tr></thead><tbody>';
  for(const r of rows){
    h+='<tr>';
    for(const k of gb.keys)h+=dimCell(k,r._k[k]);
    for(const m of METRICS){
      let cls="";
      if((m.k==="roas_d3"||m.k==="roas_d1")&&r[m.k]!=null)cls=r[m.k]>=100?"pos":r[m.k]>=50?"mid":"";
      h+=\`<td class="\${cls}">\${fmt(m.k.startsWith("cost")||m.type==="$"?(r[m.k]==null?null:+r[m.k].toFixed(2)):r[m.k],m.type)}</td>\`;
    }
    h+='</tr>';
  }
  h+='</tbody><tfoot><tr>';
  h+=\`<td class="left">합계</td>\`+gb.keys.slice(1).map(()=>'<td class="left"></td>').join("");
  const footVals={cost:+T.cost.toFixed(2),install_total:T.install_total,install_reg:T.install_reg,install_skan:T.install_skan,cpi:Tcpi==null?null:+Tcpi.toFixed(2),roas_d1:Td1,roas_d3:Td3,rev_d1:+T.rev_d1.toFixed(2),rev_d3:+T.rev_d3.toFixed(2)};
  for(const m of METRICS)h+=\`<td>\${fmt(footVals[m.k],m.type)}</td>\`;
  h+='</tr></tfoot>';
  document.getElementById("tbl").innerHTML=h;
  document.getElementById("rowcount").textContent=rows.length+"개 그룹";
}
function setSort(k){if(sortKey===k)sortDir*=-1;else{sortKey=k;sortDir=(k in DIMS)?1:-1;}render();}
function resetF(){["f-media","f-country","f-os","f-date"].forEach(id=>document.getElementById(id).value="__ALL__");render();}
document.getElementById("groupby").innerHTML=GROUPBYS.map(g=>\`<option value="\${g.id}">\${g.label}</option>\`).join("");
document.getElementById("groupby").onchange=e=>{groupbyId=e.target.value;sortKey="cost";sortDir=-1;render();};
fillSel("f-media","media");fillSel("f-country","country");fillSel("f-os","os");fillSel("f-date","date");
render();
</script>`;
writeFileSync(OUT, html, "utf8");
process.stdout.write("written len="+html.length+"\\n");
