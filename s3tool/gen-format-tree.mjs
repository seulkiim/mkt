import { readFileSync, writeFileSync } from "fs";
import { dataPath, outPath } from "./paths.mjs";
const {rows: ROWS, installs: INSTALLS} = JSON.parse(readFileSync(dataPath("format-tree-result.json"),"utf8"));
// 대시보드 B(IAA 광고매출 형식 분석) — 매일 11시 스케줄이 이 파일을 아티팩트로 재게시한다.
const OUT = outPath("format-tree.html");
const dts=[...new Set(ROWS.map(r=>r.date))].sort();
const RANGE=dts.length?dts[0].replace(/-/g,"/")+" ~ "+dts.at(-1).replace(/-/g,"/"):"";
function addDays(iso,n){const d=new Date(iso+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function md(iso){const [,m,d]=iso.split("-");return String(+m)+"/"+String(+d);}
const lastDate=dts.at(-1);
const TODAY_STR=lastDate?md(addDays(lastDate,1)):"";
const D1_WARN=lastDate?md(addDays(lastDate,-1))+"~"+md(lastDate):"";
const D3_WARN=lastDate?md(addDays(lastDate,-3))+"~"+md(lastDate):"";

const html=`<title>IAA 광고형식 분석 — 일자·국가·형식·매체</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0D1117;--surf:#161B22;--surf2:#1C2128;--border:#21262D;--border2:#30363D;--txt:#E6EDF3;--muted:#8B949E;--dim:#484F58;--good:#3FB950;--warn:#D29922;--bad:#F85149;--accent:#4E9EFF;
--google:#4E9EFF;--facebook:#FF6B35;--applovin:#C084FC;--liftoff:#34D399;--organic:#7D8590;}
body{background:var(--bg);color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;font-size:13px;min-height:100vh;}
.hdr{background:var(--surf);border-bottom:1px solid var(--border);padding:13px 18px;}
.hdr-title{font-size:15px;font-weight:700;}
.hdr-sub{font-size:11.5px;color:var(--muted);margin-top:2px;}
.main{padding:14px 18px 48px;}
.bar{display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap;}
.btn{background:var(--surf);border:1px solid var(--border2);color:var(--muted);border-radius:4px;padding:5px 11px;font-size:11.5px;cursor:pointer;}
.btn:hover{color:var(--txt);}
.crumb{font-size:11px;color:var(--muted);}
.crumb b{color:var(--accent);}
.tw{overflow-x:auto;border:1px solid var(--border);border-radius:6px;max-height:78vh;}
table{border-collapse:collapse;width:100%;font-size:12px;}
th,td{padding:6px 10px;text-align:right;border-bottom:1px solid var(--border);font-variant-numeric:tabular-nums;}
td{white-space:nowrap;}
th{background:var(--surf2);color:var(--muted);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.03em;position:sticky;top:0;z-index:2;white-space:normal;vertical-align:bottom;line-height:1.25;}
td.left,th.left{text-align:left;}
.node{cursor:pointer;user-select:none;}
.node:hover{background:var(--surf);}
.caret{display:inline-block;width:14px;color:var(--muted);font-size:9px;}
.leaf .caret{visibility:hidden;}
.lvl0{font-weight:700;}
.lvl0 td{background:rgba(78,158,255,.06);}
.bar-cell{position:relative;}
.bar-fill{position:absolute;left:0;top:0;bottom:0;background:rgba(78,158,255,.13);z-index:0;}
.bar-cell span{position:relative;z-index:1;}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;}
tfoot td{position:sticky;bottom:0;background:var(--surf2);font-weight:700;border-top:2px solid var(--border2);}
.na{color:var(--dim);}
.note{margin-top:12px;font-size:11px;color:var(--muted);background:var(--surf);border:1px solid var(--border);border-left:3px solid var(--warn);border-radius:4px;padding:9px 12px;line-height:1.6;}
.dd{position:relative;}
.ddbtn{display:inline-flex;align-items:center;gap:6px;}
#ddcount{color:var(--accent);font-weight:700;}
.ddpanel{display:none;position:absolute;top:calc(100% + 4px);left:0;z-index:20;background:var(--surf);border:1px solid var(--border2);border-radius:6px;padding:8px;min-width:220px;box-shadow:0 8px 24px rgba(0,0,0,.5);}
.ddpanel.open{display:block;}
.ddhead{display:flex;gap:6px;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid var(--border);}
.ddhead button{flex:1;font-size:10.5px;padding:3px;background:var(--surf2);border:1px solid var(--border2);color:var(--muted);border-radius:3px;cursor:pointer;}
.ddhead button:hover{color:var(--txt);}
.ddgrid{display:grid;grid-template-columns:1fr 1fr;gap:2px;max-height:260px;overflow:auto;}
.ddi{display:flex;align-items:center;gap:6px;font-size:11.5px;padding:3px 6px;border-radius:4px;cursor:pointer;color:var(--txt);}
.ddi:hover{background:var(--surf2);}
.ddi input{accent-color:var(--accent);}
/* 설치일 필터: 월(月) 행 → (펼치면) 일자 그리드 */
.dfwrap{max-height:300px;overflow:auto;min-width:212px;}
.dfmonth{border-bottom:1px solid var(--border);}
.dfmonth:last-child{border-bottom:none;}
.dfmrow{display:flex;align-items:center;}
.dfcaret{width:16px;flex-shrink:0;text-align:center;font-size:9px;color:var(--muted);cursor:pointer;user-select:none;transition:transform .12s;}
.dfcaret:hover{color:var(--txt);}
.dfmlabel{flex:1;font-weight:700;}
.dfcount{margin-left:auto;font-size:10px;color:var(--dim);font-weight:500;}
.dfdays{grid-template-columns:1fr 1fr 1fr;padding:1px 0 6px 18px;max-height:none;overflow:visible;}
.ordrow{display:flex;align-items:center;gap:8px;padding:4px 2px;}
.ordlvl{width:44px;color:var(--muted);font-size:11px;flex-shrink:0;}
.ordrow select{flex:1;background:var(--surf2);color:var(--txt);border:1px solid var(--border2);border-radius:4px;padding:4px 6px;font-size:11.5px;}
.ltv{color:var(--good);}
</style>
<div class="hdr">
  <div class="hdr-title">📺 IAA 광고매출 형식 분석</div>
  <div class="hdr-sub">${RANGE} KST · 설치일(코호트) 기준 · D1/D3 광고매출(IAA) · 유저당 LTV(D0/D1/D3/D7) 포함 · 행 클릭 시 하위 펼침</div>
</div>
<div class="main">
  <div class="bar">
    <div class="dd" id="dateDD">
      <button class="btn ddbtn" onclick="toggleDD(event,'dateDD','ddpanel')">설치일 필터 <span id="ddcount"></span> ▾</button>
      <div class="ddpanel" id="ddpanel"></div>
    </div>
    <div class="dd" id="orderDD">
      <button class="btn ddbtn" onclick="toggleDD(event,'orderDD','ordpanel')">계층 순서 ▾</button>
      <div class="ddpanel" id="ordpanel"></div>
    </div>
    <button class="btn" onclick="expandAll()">모두 펼치기</button>
    <button class="btn" onclick="collapseAll()">모두 접기</button>
    <span class="crumb" id="ordcrumb"></span>
  </div>
  <div class="tw"><table id="tbl"></table></div>
  <div class="note">
    <b>IAA(광고매출)만</b> 분석한 뷰입니다(IAP 제외). <b>형식 분류(폴백 규칙)</b>: ① placement 접두어(RV_→리워드, inter_→전면, banner→배너) → ② af_ad_type(INTER/interstitial→전면, rewarded_video→리워드, ClickToDownload→CTD/Google 등) → ③ 위 둘이 비면 <b>ad_unit의 지배 형식으로 추정</b>. (af_ad_type 빈값 레코드 $14k 대부분이 전면(Interstitial) MAX 유닛으로 재귀속됨)
    <b>D1 Rev</b>=설치 후 D0~D1 누적 광고매출, <b>D3 Rev</b>=D0~D3 누적. <b>eCPM</b>=D1매출/D1노출×1000.
    ⚠️ <b>eCPM·노출</b>은 impressions 컬럼이 ad_unit·레코드 단위에서 부정확하므로 <b>참고용</b>(형식·전체 합산에서만 신뢰). 매출은 정확.
    ⚠️ 오늘(${TODAY_STR}) 기준 <b>${D1_WARN} 코호트의 D1, ${D3_WARN}의 D3</b>는 이벤트 도착 중이라 과소 집계될 수 있음.
    <b>LTV D0/D1/D3/D7(유저당 IAA)</b>=해당 행의 IAA 매출 ÷ 그 행이 포함하는 설치 코호트 수(installs+SKAN installs, 일자·국가·매체 기준 중복제거). 설치는 형식(af_ad_type)과 무관한 개념이므로, 형식이 하위 계층에 있는 행(예: 국가 합계)의 LTV는 <b>모든 형식을 합산한 그 코호트의 전체 LTV</b>이고, 형식이 상위 계층으로 이동해 특정 형식 행이 되면 <b>그 형식이 기여한 코호트당 매출(=전체 LTV의 부분)</b>을 의미함 — 같은 코호트의 형식별 LTV를 모두 더하면 전체 LTV와 일치.
  </div>
</div>
<script>
const RAW=${JSON.stringify(ROWS)};
const INST=${JSON.stringify(INSTALLS)};
const INST_MAP={};for(const i of INST)INST_MAP[[i.date,i.country,i.media].join("|||")]=i.installs;
const MLABEL={"googleadwords_int":"Google","Facebook Ads":"Facebook","applovin_int":"Applovin","liftoff_int":"Liftoff","organic":"Organic"};
const MCOLOR={"googleadwords_int":"var(--google)","Facebook Ads":"var(--facebook)","applovin_int":"var(--applovin)","liftoff_int":"var(--liftoff)","organic":"var(--organic)"};
let LEVELS=["date","country","format","media"];
const DIMLBL={date:"설치일",country:"국가",format:"광고형식",media:"매체"};
function blank(){return {d0:0,d1:0,d3:0,d7:0,imp1:0};}
function addInto(a,r){a.d0+=r.d0;a.d1+=r.d1;a.d3+=r.d3;a.d7+=r.d7;a.imp1+=r.imp1;}
// 설치 코호트 수(중복제거): 행(rs)이 포함하는 유니크 (일자,국가,매체) 조합의 installs 합
function cohortInstalls(rs){
  const keys=new Set();
  for(const r of rs)keys.add(r.date+"|||"+r.country+"|||"+r.media);
  let n=0;for(const k of keys)n+=INST_MAP[k]||0;
  return n;
}
let idc=0;
function build(rows,depth){
  if(depth>=LEVELS.length)return null;
  const key=LEVELS[depth],grp={};
  for(const r of rows)(grp[r[key]]=grp[r[key]]||[]).push(r);
  const nodes=[];
  for(const [val,rs] of Object.entries(grp)){
    const agg=blank();for(const r of rs)addInto(agg,r);
    const installs=cohortInstalls(rs);
    const ltv=n=>installs>0?n/installs:null;
    nodes.push({id:++idc,dim:key,value:val,depth,...agg,installs,
      ltv0:ltv(agg.d0),ltv1:ltv(agg.d1),ltv3:ltv(agg.d3),ltv7:ltv(agg.d7),
      ecpm:agg.imp1>0?agg.d1/agg.imp1*1000:null,children:build(rs,depth+1)});
  }
  if(key==="date")nodes.sort((a,b)=>String(a.value).localeCompare(String(b.value)));
  else nodes.sort((a,b)=>b.d1-a.d1);
  return nodes;
}
const DATE_OPTIONS=[...new Set(RAW.map(r=>r.date))].sort();
const selectedDates=new Set(DATE_OPTIONS);
let TREE=[], maxD1=1;
function rebuild(){idc=0;TREE=build(RAW.filter(r=>selectedDates.has(r.date)),0);maxD1=Math.max(...TREE.map(n=>n.d1),1);render();}
const expanded=new Set();
function fmtV(v,t){if(v==null)return '<span class="na">–</span>';if(t==="$")return "$"+v.toLocaleString(undefined,{maximumFractionDigits:2});if(t==="n")return Math.round(v).toLocaleString();return v;}
function fmtLtv(v){return v==null?'<span class="na">–</span>':'<span class="ltv">$'+v.toFixed(3)+'</span>';}
function dimLabel(n){const v=n.value;
  if(n.dim==="media")return \`<span class="dot" style="background:\${MCOLOR[v]||'var(--organic)'}"></span>\${MLABEL[v]||v}\`;
  if(n.dim==="date")return String(v).slice(5);
  return v;}
function renderNodes(nodes,arr,parentD1){
  for(const n of nodes){
    const kids=n.children&&n.children.length,open=expanded.has(n.id);
    const pct=parentD1>0?(n.d1/parentD1*100):0;
    const barW=n.depth===0?(n.d1/maxD1*100):pct;
    let td=\`<td class="left node \${kids?'':'leaf'} lvl\${n.depth}" style="padding-left:\${10+n.depth*20}px" \${kids?\`onclick="toggle(\${n.id})"\`:''}>\`;
    td+=\`<span class="caret">\${kids?(open?'▼':'▶'):''}</span>\${dimLabel(n)}</td>\`;
    // D1 Rev with bar
    td+=\`<td class="bar-cell"><div class="bar-fill" style="width:\${Math.max(0,Math.min(100,barW))}%"></div><span>\${fmtV(+n.d1.toFixed(2),"$")}</span></td>\`;
    td+=\`<td>\${n.depth>0?pct.toFixed(0)+'%':'—'}</td>\`;
    td+=\`<td>\${fmtV(+n.d3.toFixed(2),"$")}</td>\`;
    td+=\`<td>\${fmtV(n.installs,"n")}</td>\`;
    td+=\`<td>\${fmtLtv(n.ltv0)}</td>\`;
    td+=\`<td>\${fmtLtv(n.ltv1)}</td>\`;
    td+=\`<td>\${fmtLtv(n.ltv3)}</td>\`;
    td+=\`<td>\${fmtLtv(n.ltv7)}</td>\`;
    td+=\`<td>\${fmtV(n.imp1,"n")}</td>\`;
    td+=\`<td>\${n.ecpm==null?'<span class="na">–</span>':'$'+n.ecpm.toFixed(2)}</td>\`;
    arr.push("<tr>"+td+"</tr>");
    if(kids&&open)renderNodes(n.children,arr,n.d1);
  }
}
function render(){
  const selRows=RAW.filter(r=>selectedDates.has(r.date));
  const T=blank();for(const r of selRows)addInto(T,r);
  const tInstalls=cohortInstalls(selRows);
  const tLtv=n=>tInstalls>0?fmtLtv(n/tInstalls):'<span class="na">–</span>';
  const hdrPath=LEVELS.map(d=>DIMLBL[d]).join(" › ");
  let h=\`<thead><tr><th class="left">\${hdrPath}</th><th>D1 Rev<br>(IAA)</th><th>상위<br>비중</th><th>D3 Rev<br>(IAA)</th><th>설치수<br>(LTV 분모)</th><th>LTV<br>D0</th><th>LTV<br>D1</th><th>LTV<br>D3</th><th>LTV<br>D7</th><th>D1 노출<br>(참고)</th><th>eCPM<br>(참고)</th></tr></thead><tbody>\`;
  const arr=[];renderNodes(TREE,arr,T.d1);h+=arr.join("");
  h+='</tbody><tfoot><tr><td class="left">전체 합계</td>'+
     \`<td>\${fmtV(+T.d1.toFixed(2),"$")}</td><td>100%</td><td>\${fmtV(+T.d3.toFixed(2),"$")}</td><td>\${fmtV(tInstalls,"n")}</td><td>\${tLtv(T.d0)}</td><td>\${tLtv(T.d1)}</td><td>\${tLtv(T.d3)}</td><td>\${tLtv(T.d7)}</td><td>\${fmtV(T.imp1,"n")}</td><td>\${T.imp1>0?'$'+(T.d1/T.imp1*1000).toFixed(2):'–'}</td></tr></tfoot>\`;
  document.getElementById("tbl").innerHTML=h;
}
function toggle(id){expanded.has(id)?expanded.delete(id):expanded.add(id);render();}
function allIds(nodes,acc){for(const n of nodes){if(n.children&&n.children.length){acc.push(n.id);allIds(n.children,acc);}}return acc;}
function expandAll(){allIds(TREE,[]).forEach(id=>expanded.add(id));render();}
function collapseAll(){expanded.clear();render();}
// 설치일 필터: 월(月) 행이 먼저 보이고 ▶를 누르면 그 달의 일자가 펼쳐진다(사용자 요청 — 기간이
// 한 달을 넘으면서 평평한 일자 목록으로는 원하는 날짜를 찾기 어려워졌다). 월 체크박스는 그 달
// 전체를 켜고/끄며, 일부만 선택된 달은 indeterminate(–)로 보여 준다.
const openMonths=new Set();
function monthsOf(opts){const out=[];for(const d of opts){const k=d.slice(0,7);if(!out.includes(k))out.push(k);}return out;}
function monthLabel(mk){const p=mk.split("-");return p[0]+"년 "+(+p[1])+"월";}
function renderChips(){
  document.getElementById("ddcount").textContent=selectedDates.size===DATE_OPTIONS.length?"(전체)":"("+selectedDates.size+")";
  let h='<div class="ddhead"><button onclick="allDates(true)">전체선택</button><button onclick="allDates(false)">전체해제</button></div><div class="dfwrap">';
  for(const mk of monthsOf(DATE_OPTIONS)){
    const days=DATE_OPTIONS.filter(d=>d.slice(0,7)===mk);
    const on=days.filter(d=>selectedDates.has(d)).length;
    const open=openMonths.has(mk);
    h+=\`<div class="dfmonth"><div class="dfmrow">
      <span class="dfcaret" style="transform:rotate(\${open?90:0}deg)" onclick="toggleMonthOpen('\${mk}')">▶</span>
      <label class="ddi dfmlabel"><input type="checkbox" \${on===days.length?'checked':''} data-part="\${(on>0&&on<days.length)?1:0}" onchange="toggleMonth('\${mk}')">\${monthLabel(mk)}<span class="dfcount">\${on}/\${days.length}</span></label>
    </div>\`;
    if(open)h+='<div class="ddgrid dfdays">'+days.map(d=>\`<label class="ddi"><input type="checkbox" \${selectedDates.has(d)?'checked':''} onchange="toggleDate('\${d}')">\${+d.slice(8)}일</label>\`).join("")+'</div>';
    h+='</div>';
  }
  const panel=document.getElementById("ddpanel");
  panel.innerHTML=h+'</div>';
  // indeterminate는 HTML 속성으로 표현할 수 없어 렌더 후 JS로 지정한다.
  panel.querySelectorAll('input[data-part="1"]').forEach(el=>{el.indeterminate=true;});
}
function toggleMonthOpen(mk){openMonths.has(mk)?openMonths.delete(mk):openMonths.add(mk);renderChips();}
function toggleMonth(mk){
  const days=DATE_OPTIONS.filter(d=>d.slice(0,7)===mk), allOn=days.every(d=>selectedDates.has(d));
  for(const d of days){if(allOn)selectedDates.delete(d);else selectedDates.add(d);}
  expanded.clear();renderChips();rebuild();
}
function toggleDate(d){selectedDates.has(d)?selectedDates.delete(d):selectedDates.add(d);expanded.clear();renderChips();rebuild();}
function allDates(on){selectedDates.clear();if(on)DATE_OPTIONS.forEach(d=>selectedDates.add(d));expanded.clear();renderChips();rebuild();}
function toggleDD(e,ddId,panelId){e.stopPropagation();document.getElementById(panelId).classList.toggle("open");}
document.addEventListener("click",e=>{
  if(!document.getElementById("dateDD").contains(e.target))document.getElementById("ddpanel").classList.remove("open");
  if(!document.getElementById("orderDD").contains(e.target))document.getElementById("ordpanel").classList.remove("open");
});
function renderOrderPanel(){
  const rows=LEVELS.map((dim,i)=>{
    const opts=LEVELS.map(d=>\`<option value="\${d}" \${d===dim?"selected":""}>\${DIMLBL[d]}</option>\`).join("");
    return \`<div class="ordrow"><span class="ordlvl">\${i+1}단계</span><select onchange="setLevel(\${i},this.value)">\${opts}</select></div>\`;
  }).join("");
  document.getElementById("ordpanel").innerHTML=rows;
  document.getElementById("ordcrumb").innerHTML=LEVELS.map(d=>"<b>"+DIMLBL[d]+"</b>").join(" › ")+" · 일자는 오름차순, 나머지는 D1 매출 내림차순";
}
function setLevel(i,val){
  const j=LEVELS.indexOf(val);
  if(j===i)return;
  [LEVELS[i],LEVELS[j]]=[LEVELS[j],LEVELS[i]];
  expanded.clear();
  renderOrderPanel();
  rebuild();
}
renderChips();renderOrderPanel();rebuild();
</script>`;
writeFileSync(OUT,html,"utf8");
process.stdout.write("written len="+html.length+"\\n");
