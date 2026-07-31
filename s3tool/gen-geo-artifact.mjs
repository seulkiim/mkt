import { readFileSync, writeFileSync } from "fs";
const data = JSON.parse(readFileSync("C:/Users/STZ940/s3tool/geo-cohort-result.json","utf8"));

const OUT = "C:/Users/STZ940/AppData/Local/Temp/claude/C--Users-STZ940-Documents-GitHub-mkt-report/899eecf2-8a64-43ee-88a7-a363205d50ef/scratchpad/geo-cohort-report.html";

const html = `<title>Geo & Cohort Performance — Idol Farm Life · 7/7–7/13 KST</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0D1117;--surf:#161B22;--surf2:#1C2128;--border:#21262D;--border2:#30363D;
  --txt:#E6EDF3;--muted:#8B949E;--dim:#484F58;
  --google:#4E9EFF;--facebook:#FF6B35;--applovin:#C084FC;--liftoff:#34D399;--organic:#7D8590;
  --good:#3FB950;--warn:#D29922;--bad:#F85149;--accent:#4E9EFF;
  --radius:6px;
}
body{background:var(--bg);color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;font-size:13px;line-height:1.5;min-height:100vh;}
.hdr{background:var(--surf);border-bottom:1px solid var(--border);padding:14px 20px;}
.hdr-title{font-size:15px;font-weight:700;letter-spacing:-.2px;}
.hdr-sub{font-size:11.5px;color:var(--muted);margin-top:2px;}
.tabs{display:flex;background:var(--surf);border-bottom:1px solid var(--border);padding:0 20px;}
.tab{padding:9px 14px;font-size:13px;font-weight:500;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;user-select:none;}
.tab:hover{color:var(--txt);}
.tab.active{color:var(--txt);border-bottom-color:var(--accent);}
.main{padding:16px 20px 48px;}
.view{display:none;}.view.active{display:block;}
.ctrl{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px;}
.fg{display:flex;flex-direction:column;gap:4px;}
.fg label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;}
select{background:var(--surf);border:1px solid var(--border2);color:var(--txt);border-radius:4px;padding:5px 8px;font-size:12.5px;min-width:150px;}
.mbtns{display:flex;gap:5px;flex-wrap:wrap;}
.mbtn{padding:4px 10px;font-size:11.5px;font-weight:500;background:var(--surf);border:1px solid var(--border2);border-radius:4px;color:var(--muted);cursor:pointer;white-space:nowrap;}
.mbtn:hover{color:var(--txt);}
.mbtn.active{background:#1C2A3A;border-color:var(--accent);color:var(--accent);}
.tw{overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius);}
table{border-collapse:collapse;width:100%;font-size:12px;}
th,td{padding:7px 10px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--border);font-variant-numeric:tabular-nums;}
th{background:var(--surf2);color:var(--muted);font-weight:600;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;position:sticky;top:0;}
td.left,th.left{text-align:left;}
tbody tr:hover{background:var(--surf);}
.media-badge{display:inline-flex;align-items:center;gap:6px;font-weight:600;}
.dot{width:8px;height:8px;border-radius:50%;flex:none;}
.c-best{background:rgba(63,185,80,.22);}
.c-mid{background:rgba(63,185,80,.12);}
.c-ok{background:rgba(210,153,34,.10);}
.na{color:var(--dim);}
.note{margin-top:12px;font-size:11px;color:var(--muted);background:var(--surf);border:1px solid var(--border);border-left:3px solid var(--warn);border-radius:4px;padding:9px 12px;line-height:1.6;}
.sec{font-size:12px;font-weight:700;margin:18px 0 8px;color:var(--txt);letter-spacing:-.1px;}
.small{font-size:11px;color:var(--muted);}
</style>

<div class="hdr">
  <div class="hdr-title">📍 국가별 · 코호트 성과 리포트 — Idol Farm Life</div>
  <div class="hdr-sub">2026/07/07 ~ 07/13 KST · 매체 × 국가 × 일 성과 및 코호트(설치일 기준) D1/D3 ROAS · SKAD+일반 통합</div>
</div>

<div class="tabs">
  <div class="tab active" onclick="tab('daily',this)">일별 성과 (매체×국가)</div>
  <div class="tab" onclick="tab('cohort',this)">코호트 ROAS (D1/D3)</div>
</div>

<div class="main">
  <div id="v-daily" class="view active">
    <div class="ctrl">
      <div class="fg"><label>국가</label><select id="d-country"></select></div>
      <div class="fg"><label>지표</label>
        <div class="mbtns" id="d-metrics"></div>
      </div>
    </div>
    <div class="tw"><table id="d-table"></table></div>
    <div class="note">
      <b>일별 성과</b>는 <b>이벤트 발생일(calendar) 기준</b> 집계입니다. 매출 = IAP(af_purchase) + IAA(ad_revenue).
      비용/노출/클릭은 cost_etl_summary(최신 dt=·최대 v=), 설치는 일반+SKAD(af_attribution_flag≠true).
      국가는 이벤트/설치의 country_code, 비용은 geo 기준. <b>"전체"</b>는 모든 국가 합산.
    </div>
    <div class="sec">매출 상위 국가 (기간 합산)</div>
    <div class="tw"><table id="d-countryrank"></table></div>
  </div>

  <div id="v-cohort" class="view">
    <div class="ctrl">
      <div class="fg"><label>국가</label><select id="c-country"></select></div>
      <div class="fg"><label>지표</label>
        <div class="mbtns" id="c-metrics"></div>
      </div>
    </div>
    <div class="tw"><table id="c-table"></table></div>
    <div class="note">
      <b>코호트 ROAS</b>: 설치일(install_date)을 코호트로 고정하고, 그 코호트가 발생시킨 매출을 설치 후 경과일로 누적합니다.
      <b>D1 ROAS = (D0~D1 누적매출) / 설치일 비용</b>, <b>D3 ROAS = (D0~D3 누적매출) / 설치일 비용</b> (설치일=D0).
      ⚠️ 오늘은 7/15라 <b>7/12 코호트의 D3, 7/13 코호트의 D1·D3</b>는 아직 이벤트가 도착 중이라 과소 집계될 수 있습니다(특히 IAA는 dt=7/14까지만 존재).
    </div>
  </div>
</div>

<script>
const DAILY = ${JSON.stringify(data.daily)};
const COHORT = ${JSON.stringify(data.cohort)};
const MEDIA_ORDER=["googleadwords_int","Facebook Ads","applovin_int","liftoff_int","organic"];
const MLABEL={"googleadwords_int":"Google","Facebook Ads":"Facebook","applovin_int":"Applovin","liftoff_int":"Liftoff","organic":"Organic"};
const MCOLOR={"googleadwords_int":"var(--google)","Facebook Ads":"var(--facebook)","applovin_int":"var(--applovin)","liftoff_int":"var(--liftoff)","organic":"var(--organic)"};
const DATES=["2026-07-07","2026-07-08","2026-07-09","2026-07-10","2026-07-11","2026-07-12","2026-07-13"];
const DLBL=d=>d.slice(5).replace("-","/");

function mediaOf(rows,key){const m={};for(const r of rows){if(!MEDIA_ORDER.includes(r.media))continue;m[r.media]=1;}return MEDIA_ORDER.filter(x=>m[x]);}
function countryOptions(rows){
  const rev={};for(const r of rows){const v=r.revenue!==undefined?r.revenue:(r.rev_d3||0);rev[r.country]=(rev[r.country]||0)+v;}
  return Object.entries(rev).sort((a,b)=>b[1]-a[1]).map(([c])=>c);
}
function fillCountry(sel,rows){
  const opts=countryOptions(rows);
  sel.innerHTML='<option value="__ALL__">전체 (모든 국가 합산)</option>'+opts.map(c=>\`<option value="\${c}">\${c}</option>\`).join("");
}

// ---------- DAILY ----------
const D_METRICS=[
  {k:"installs",label:"설치",fmt:"n",best:"max"},
  {k:"cost",label:"비용",fmt:"$",best:"min"},
  {k:"revenue",label:"매출",fmt:"$",best:"max"},
  {k:"roas",label:"ROAS",fmt:"%",best:"max"},
  {k:"cpi",label:"CPI",fmt:"$",best:"min"},
];
let dMetric="roas";
function aggDaily(country){
  // key media|date -> sums
  const m={};
  for(const r of DAILY){
    if(country!=="__ALL__"&&r.country!==country)continue;
    const k=r.media+"|"+r.date;
    if(!m[k])m[k]={media:r.media,date:r.date,installs:0,cost:0,imp:0,clk:0,revenue:0};
    m[k].installs+=r.installs;m[k].cost+=r.cost;m[k].imp+=r.impressions;m[k].clk+=r.clicks;m[k].revenue+=r.revenue;
  }
  for(const e of Object.values(m)){
    e.cpi=e.cost>0&&e.installs>0?e.cost/e.installs:null;
    e.roas=e.cost>0&&e.revenue>0?e.revenue/e.cost*100:null;
  }
  return m;
}
function fmtV(v,fmt){if(v==null)return '<span class="na">–</span>';if(fmt==="$")return "$"+v.toLocaleString(undefined,{maximumFractionDigits:2});if(fmt==="%")return v.toFixed(1)+"%";return Math.round(v).toLocaleString();}
function heat(v,vals,best){if(v==null)return"";const s=vals.filter(x=>x!=null&&x>0).sort((a,b)=>best==="max"?b-a:a-b);if(!s.length)return"";const q1=s[Math.floor(s.length*.25)],q2=s[Math.floor(s.length*.5)],q3=s[Math.floor(s.length*.75)];if(best==="max")return v>=q1?"c-best":v>=q2?"c-mid":v>=q3?"c-ok":"";return v<=q1?"c-best":v<=q2?"c-mid":v<=q3?"c-ok":"";}
function renderDaily(){
  const country=document.getElementById("d-country").value;
  const agg=aggDaily(country);
  const meta=D_METRICS.find(x=>x.k===dMetric);
  const medias=MEDIA_ORDER.filter(m=>DATES.some(d=>agg[m+"|"+d]));
  const allVals=[];for(const m of medias)for(const d of DATES){const e=agg[m+"|"+d];if(e)allVals.push(e[dMetric]);}
  let h='<thead><tr><th class="left">매체</th>'+DATES.map(d=>\`<th>\${DLBL(d)}</th>\`).join("")+'<th>합계/평균</th></tr></thead><tbody>';
  for(const m of medias){
    h+=\`<tr><td class="left"><span class="media-badge"><span class="dot" style="background:\${MCOLOR[m]}"></span>\${MLABEL[m]}</span></td>\`;
    let sc=0,sr=0,si=0,sco=0;
    for(const d of DATES){
      const e=agg[m+"|"+d];const v=e?e[dMetric]:null;
      h+=\`<td class="\${heat(v,allVals,meta.best)}">\${fmtV(v,meta.fmt)}</td>\`;
      if(e){sc+=e.cost;sr+=e.revenue;si+=e.installs;sco+=e.cost;}
    }
    // 합계열: 지표별
    let tot=null;
    if(dMetric==="installs")tot=si;else if(dMetric==="cost")tot=sc;else if(dMetric==="revenue")tot=sr;
    else if(dMetric==="roas")tot=sc>0?sr/sc*100:null;else if(dMetric==="cpi")tot=si>0?sc/si:null;
    h+=\`<td style="font-weight:700;border-left:1px solid var(--border2)">\${fmtV(tot,meta.fmt)}</td></tr>\`;
  }
  h+="</tbody>";
  document.getElementById("d-table").innerHTML=h;
}
function renderCountryRank(){
  const m={};
  for(const r of DAILY){if(!m[r.country])m[r.country]={c:r.country,installs:0,cost:0,revenue:0};m[r.country].installs+=r.installs;m[r.country].cost+=r.cost;m[r.country].revenue+=r.revenue;}
  const arr=Object.values(m).sort((a,b)=>b.revenue-a.revenue).slice(0,12);
  let h='<thead><tr><th class="left">국가</th><th>설치</th><th>비용</th><th>매출</th><th>ROAS</th></tr></thead><tbody>';
  for(const r of arr){const roas=r.cost>0?r.revenue/r.cost*100:null;h+=\`<tr><td class="left">\${r.c}</td><td>\${Math.round(r.installs).toLocaleString()}</td><td>$\${r.cost.toLocaleString(undefined,{maximumFractionDigits:0})}</td><td>$\${r.revenue.toLocaleString(undefined,{maximumFractionDigits:0})}</td><td>\${roas==null?'–':roas.toFixed(1)+'%'}</td></tr>\`;}
  h+="</tbody>";document.getElementById("d-countryrank").innerHTML=h;
}

// ---------- COHORT ----------
const C_METRICS=[
  {k:"roas_d1",label:"D1 ROAS",fmt:"%",best:"max"},
  {k:"roas_d3",label:"D3 ROAS",fmt:"%",best:"max"},
  {k:"rev_d1",label:"D1 매출",fmt:"$",best:"max"},
  {k:"rev_d3",label:"D3 매출",fmt:"$",best:"max"},
  {k:"cost",label:"비용",fmt:"$",best:"min"},
  {k:"installs",label:"설치",fmt:"n",best:"max"},
];
let cMetric="roas_d1";
function aggCohort(country){
  const m={};
  for(const r of COHORT){
    if(country!=="__ALL__"&&r.country!==country)continue;
    const k=r.media+"|"+r.cohort_date;
    if(!m[k])m[k]={media:r.media,date:r.cohort_date,installs:0,cost:0,rev_d1:0,rev_d3:0};
    m[k].installs+=r.installs;m[k].cost+=r.cost;m[k].rev_d1+=r.rev_d1;m[k].rev_d3+=r.rev_d3;
  }
  for(const e of Object.values(m)){
    e.roas_d1=e.cost>0&&e.rev_d1>0?e.rev_d1/e.cost*100:null;
    e.roas_d3=e.cost>0&&e.rev_d3>0?e.rev_d3/e.cost*100:null;
  }
  return m;
}
function renderCohort(){
  const country=document.getElementById("c-country").value;
  const agg=aggCohort(country);
  const meta=C_METRICS.find(x=>x.k===cMetric);
  const medias=MEDIA_ORDER.filter(m=>DATES.some(d=>agg[m+"|"+d]&&agg[m+"|"+d].cost>0));
  const allVals=[];for(const m of medias)for(const d of DATES){const e=agg[m+"|"+d];if(e)allVals.push(e[cMetric]);}
  let h='<thead><tr><th class="left">매체 \\\\ 설치코호트</th>'+DATES.map(d=>\`<th>\${DLBL(d)}\${d>="2026-07-12"?' <span class="small">*</span>':''}</th>\`).join("")+'<th>가중평균</th></tr></thead><tbody>';
  for(const m of medias){
    h+=\`<tr><td class="left"><span class="media-badge"><span class="dot" style="background:\${MCOLOR[m]}"></span>\${MLABEL[m]}</span></td>\`;
    let sc=0,s1=0,s3=0,si=0;
    for(const d of DATES){
      const e=agg[m+"|"+d];const v=e?e[cMetric]:null;
      h+=\`<td class="\${heat(v,allVals,meta.best)}">\${fmtV(v,meta.fmt)}</td>\`;
      if(e){sc+=e.cost;s1+=e.rev_d1;s3+=e.rev_d3;si+=e.installs;}
    }
    let tot=null;
    if(cMetric==="roas_d1")tot=sc>0?s1/sc*100:null;else if(cMetric==="roas_d3")tot=sc>0?s3/sc*100:null;
    else if(cMetric==="rev_d1")tot=s1;else if(cMetric==="rev_d3")tot=s3;else if(cMetric==="cost")tot=sc;else if(cMetric==="installs")tot=si;
    h+=\`<td style="font-weight:700;border-left:1px solid var(--border2)">\${fmtV(tot,meta.fmt)}</td></tr>\`;
  }
  h+="</tbody>";
  document.getElementById("c-table").innerHTML=h;
}

// ---------- init ----------
function tab(name,el){document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));el.classList.add("active");document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));document.getElementById("v-"+name).classList.add("active");}
function buildMetrics(containerId,metrics,cur,onpick){
  const c=document.getElementById(containerId);
  c.innerHTML=metrics.map(m=>\`<button class="mbtn \${m.k===cur?'active':''}" data-k="\${m.k}">\${m.label}</button>\`).join("");
  c.querySelectorAll(".mbtn").forEach(b=>b.onclick=()=>{c.querySelectorAll(".mbtn").forEach(x=>x.classList.remove("active"));b.classList.add("active");onpick(b.dataset.k);});
}
fillCountry(document.getElementById("d-country"),DAILY);
fillCountry(document.getElementById("c-country"),COHORT);
document.getElementById("d-country").onchange=renderDaily;
document.getElementById("c-country").onchange=renderCohort;
buildMetrics("d-metrics",D_METRICS,dMetric,k=>{dMetric=k;renderDaily();});
buildMetrics("c-metrics",C_METRICS,cMetric,k=>{cMetric=k;renderCohort();});
renderDaily();renderCountryRank();renderCohort();
</script>`;

writeFileSync(OUT, html, "utf8");
process.stdout.write("HTML written: "+OUT+"\\n length="+html.length+"\\n");
