import { readFileSync, writeFileSync } from "fs";
import { dataPath, outPath } from "./paths.mjs";
// 리포트에서 제외할 (campaign, country) 조합(사용자 요청). 캠페인 전체가 아니라, 캠페인명의
// 지역 타겟(예: "2607_if_kr_ua_ios_install_meta_dl"의 kr=Korea)과 실제 귀속 country_code가
// 어긋난 오귀속 행만 제외한다 — 예: kr 타겟 캠페인인데 country=US로 잘못 귀속된 설치/매출.
// 같은 캠페인이라도 그 외 국가(KR·VN·TH 등)의 정상 데이터는 그대로 유지.
const EXCLUDED_CAMPAIGN_COUNTRY = new Set([
  "2607_if_kr_ua_ios_install_meta_dl|||US",
]);
// 리포트에서 국가 불문 전체 제외할 캠페인(사용자 요청). 실제 캠페인이 아니라 매체 쪽 트래킹
// 매크로가 치환되지 않은 placeholder 등 — 예: Applovin "{CAMPAIGN_NAME}"(cost/install/매출 전부 0).
const EXCLUDED_CAMPAIGNS_FULL = new Set([
  "{CAMPAIGN_NAME}",
]);
const RESULT_DATA = JSON.parse(readFileSync(dataPath("geo-cohort-os-result.json"),"utf8"));
const ROWS = RESULT_DATA.rows
  .filter(r => !EXCLUDED_CAMPAIGNS_FULL.has(r.campaign) && !EXCLUDED_CAMPAIGN_COUNTRY.has(`${r.campaign}|||${r.country}`));
// D21/D30 예측(사용자 요청)용 — 국가/캠페인 합산(pooled) 일자별 코호트 나이(day) 매출 곡선. 국가 필터와 무관.
const CURVE_BY_OS = RESULT_DATA.curveByOs || {};
// DAU/Active REV(캘린더 날짜 기준, 코호트 아님) — ROWS와 동일한 제외 필터 적용.
const DAILY_ACTIVE = (RESULT_DATA.dailyActive||[])
  .filter(r => !EXCLUDED_CAMPAIGNS_FULL.has(r.campaign) && !EXCLUDED_CAMPAIGN_COUNTRY.has(`${r.campaign}|||${r.country}`));
// "전체 합계" DAU 전용 dedup 유저 ID(국가별·날짜별) — 세그먼트/캠페인 분해가 없으므로 별도 제외 필터 불필요.
const DAU_USERS = RESULT_DATA.dauUsers || {};
// 소재 단위에서 제외할 값(사용자 요청). 캠페인 쪽 "{CAMPAIGN_NAME}"과 같은 유형 — 매체 트래킹
// 매크로가 치환되지 않고 그대로 들어온 것으로, 비용·설치·매출이 모두 0이라 분석 가치가 없다.
const EXCLUDED_CREATIVES = new Set([
  "{AD_NAME}",
]);
// 소재(creative) 뎁스 + 주차별 버킷(사용자 요청) — ROWS(일자별, 소재 없음)와 완전히 별개의 데이터셋.
// campaign/country 제외 필터는 ROWS와 동일하게 적용.
const ROWS_CREATIVE = (RESULT_DATA.rowsCreative||[])
  .filter(r => !EXCLUDED_CAMPAIGNS_FULL.has(r.campaign) && !EXCLUDED_CAMPAIGN_COUNTRY.has(`${r.campaign}|||${r.country}`))
  .filter(r => !EXCLUDED_CREATIVES.has(r.creative));
// 대시보드 A(국가/OS/매체/일자별 성과) — 매일 11시 스케줄이 이 파일을 아티팩트로 재게시한다.
const OUT = outPath("geo-cohort-table.html");

const _dates=[...new Set(ROWS.map(r=>r.date))].sort();
const RANGE=_dates.length?(_dates[0].replace(/-/g,"/")+" ~ "+_dates[_dates.length-1].replace(/-/g,"/")):"";

// ══════════════════════════════════════════════════════════════════════════
// Tab 1(Summary)/Tab 3(Cohort Trend)용 정적 SVG 차트 — 생성 시점(Node)에 미리 계산해
// 굽는다. Data Table 탭의 클라이언트 필터(설치일/국가)와는 독립적인 전체 데이터 스냅샷.
// ══════════════════════════════════════════════════════════════════════════
const UNKNOWN_COUNTRIES=new Set(["??","N/A",""]);
const CHART_ROWS=ROWS.filter(r=>!UNKNOWN_COUNTRIES.has(r.country));
const CHART_DATES=[...new Set(CHART_ROWS.map(r=>r.date))].sort();

function escXml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

// ── Tab 1: 기본 선택 국가(Cost 상위 9개국) 시드값만 서버에서 계산 — 실제 차트는
// 필터(설치일/국가) 반응이 필요해 클라이언트 JS에서 RAW_ALL 기반으로 그린다.
const TOPN=9;
const _costByCountry={};
for(const r of CHART_ROWS)_costByCountry[r.country]=(_costByCountry[r.country]||0)+r.cost;
const TOP_COUNTRIES=Object.entries(_costByCountry).sort((a,b)=>b[1]-a[1]).slice(0,TOPN).map(([c])=>c);
// 국가별 고정 색상 팔레트 — Cohort Trend 탭의 국가별 차트 제목·증분율 차트에서 공통으로 사용해
// 같은 국가는 어느 그래프에서든 같은 색으로 식별할 수 있게 한다.
const COUNTRY_PALETTE=["#4E9EFF","#F85149","#3FB950","#F2A93C","#C084FC","#34D399","#FF6B9D","#60A5FA","#FBBF24"];
const countryColor=c=>COUNTRY_PALETTE[TOP_COUNTRIES.indexOf(c)%COUNTRY_PALETTE.length];

// ── Tab 3(Cohort Trend): 일자별 D1/D3/D7 라인차트 + 국가·OS별 라인차트 + ROAS 증분율(기울기) 차트 ──
function dailyAgg(){
  const byDate={};
  for(const d of CHART_DATES)byDate[d]={cost:0,rev_d1:0,rev_d3:0,rev_d7:0,rev_d14:0,rev_d21:0,rev_d30:0};
  for(const r of CHART_ROWS){
    const b=byDate[r.date];
    b.cost+=r.cost; b.rev_d1+=r.rev_d1; b.rev_d3+=r.rev_d3; b.rev_d7+=(r.rev_d7||0);
    b.rev_d14+=(r.rev_d14||0); b.rev_d21+=(r.rev_d21||0); b.rev_d30+=(r.rev_d30||0);
  }
  return CHART_DATES.map(d=>{
    const b=byDate[d];
    return {
      date:d, cost:b.cost, rev_d1:b.rev_d1, rev_d3:b.rev_d3, rev_d7:b.rev_d7,
      rev_d14:b.rev_d14, rev_d21:b.rev_d21, rev_d30:b.rev_d30,
      roas_d1:b.cost>0?b.rev_d1/b.cost*100:null,
      roas_d3:b.cost>0?b.rev_d3/b.cost*100:null,
      roas_d7:b.cost>0&&b.rev_d7>0?b.rev_d7/b.cost*100:null,
      roas_d14:b.cost>0&&b.rev_d14>0?b.rev_d14/b.cost*100:null,
      roas_d21:b.cost>0&&b.rev_d21>0?b.rev_d21/b.cost*100:null,
      roas_d30:b.cost>0&&b.rev_d30>0?b.rev_d30/b.cost*100:null,
    };
  });
}
const DAILY_AGG=dailyAgg();
const DAILY_AGG_MAP={};for(const r of DAILY_AGG)DAILY_AGG_MAP[r.date]=r;
// D7이 완성되려면 설치 후 7일 경과 필요 — 최근 며칠 이내 코호트는 D1/D3/D7 각각의 완성 시점 전까지 그래프에서 제외(미완성 데이터로 곡선 왜곡 방지)
const D7_CUTOFF=CHART_DATES.length?CHART_DATES[CHART_DATES.length-1]:null;
function daysAgo(d){ if(!D7_CUTOFF)return 999; return Math.round((Date.parse(D7_CUTOFF+"T00:00:00Z")-Date.parse(d+"T00:00:00Z"))/86400000); }
// D1/D3/D7 각 지표에 실제로 포함된 코호트(설치일) 구간 — Cohort Trend 탭 Remark 위에 안내 문구로 표시.
function fmtDateSlash(d){ return d?d.replace(/-/g,"/"):"–"; }
const D1_DATES=CHART_DATES.filter(d=>daysAgo(d)>=1);
const D3_DATES=CHART_DATES.filter(d=>daysAgo(d)>=3);
const D7_DATES=CHART_DATES.filter(d=>daysAgo(d)>=7);
const D14_DATES=CHART_DATES.filter(d=>daysAgo(d)>=14);
const D21_DATES=CHART_DATES.filter(d=>daysAgo(d)>=21);
const D30_DATES=CHART_DATES.filter(d=>daysAgo(d)>=30);
function cohortRangeText(dates){
  if(!dates.length)return "포함된 코호트 없음";
  return `${fmtDateSlash(dates[0])} ~ ${fmtDateSlash(dates[dates.length-1])} (${dates.length}일)`;
}
const COHORT_RANGE_NOTE=`<div class="tabnote">포함된 코호트(설치일) 구간 — <b>D1</b>: ${cohortRangeText(D1_DATES)} · <b>D3</b>: ${cohortRangeText(D3_DATES)} · <b>D7</b>: ${cohortRangeText(D7_DATES)} · <b>D14</b>: ${cohortRangeText(D14_DATES)} · <b>D21</b>: ${cohortRangeText(D21_DATES)} · <b>D30</b>: ${cohortRangeText(D30_DATES)}</div>`;
const fmtDollar=v=>v==null?"–":"$"+(+v).toLocaleString(undefined,{maximumFractionDigits:0});
const fmtPct=v=>v==null?"–":(+v).toFixed(0)+"%";
function countryLabelSSR(v){ if(v==="WW")return "WW(SKAN)"; if(["??","N/A",""].includes(v))return "미상"; return v; }

// ══════════════════════════════════════════════════════════════════════════
// D21/D30 예측(사용자 요청): 아직 코호트가 도래하지 않은 D14/D21/D30 지점을, 이미 도래한
// 코호트의 "일(day) 단위 세분화" 데이터로부터 추정한다. 국가별 표본은 작아 일자별 곡선이
// 들쭉날쭉하므로, OS 단위로 국가·캠페인을 모두 풀링한 코호트-나이(day)별 누적 ROAS 증가
// 곡선을 만들고, ln(day+1)에 대한 선형회귀로 그 "모양(shape)"만 추출한다.
// 각 국가의 예측치는 그 국가의 마지막 실측 지점에 이 모양으로 계산한 증분만 이어 붙인다
// (국가 자체의 절대적인 실측 성과는 그대로 두고, 그 다음 구간의 "전형적인 증가율"만 빌려온다).
// ══════════════════════════════════════════════════════════════════════════
function linreg(xs,ys){
  const n=xs.length;
  if(n<2)return {slope:0,intercept:ys.length?ys[0]:0};
  const mx=xs.reduce((a,b)=>a+b,0)/n, my=ys.reduce((a,b)=>a+b,0)/n;
  let num=0,den=0;
  for(let i=0;i<n;i++){ num+=(xs[i]-mx)*(ys[i]-my); den+=(xs[i]-mx)**2; }
  const slope=den!==0?num/den:0;
  return {slope,intercept:my-slope*mx};
}
// os 풀링 데이터(복수 os 지정 시 함께 합산 풀링)에서, 코호트 나이 k일까지 실제로 도래한(daysAgo>=k)
// 설치일만 모아 누적 ROAS(%) 계산.
function pooledRoasAt(osList,k){
  const list=Array.isArray(osList)?osList:[osList];
  let cost=0,rev=0;
  for(const os of list){
    const rows=CURVE_BY_OS[os]||[];
    for(const r of rows){
      if(daysAgo(r.date)<k)continue;
      cost+=r.cost;
      for(let i=0;i<=k && i<r.dayRev.length;i++)rev+=r.dayRev[i];
    }
  }
  return cost>0?rev/cost*100:null;
}
// os(들)별로 k=1..(실제 도래한 최대 일수)까지의 "D1 대비 증분율(%)" 실측 곡선을 만들고,
// ln(k+1)에 선형회귀를 적합해 향후 시점(예: 21,30일)을 외삽하는 함수를 반환한다.
function buildGrowthPredictor(osList){
  const roas1=pooledRoasAt(osList,1);
  const xs=[],ys=[];
  const KMAX=30;
  for(let k=1;k<=KMAX;k++){
    const rk=pooledRoasAt(osList,k);
    if(roas1==null||roas1<=0||rk==null)continue; // 아직 도래 안 한 k는 표본에서 제외(실측만 사용)
    xs.push(Math.log(k+1)); ys.push((rk-roas1)/roas1*100);
  }
  if(xs.length<2)return {predict:()=>null,sampleDays:xs.length};
  const {slope,intercept}=linreg(xs,ys);
  return {predict:k=>slope*Math.log(k+1)+intercept, sampleDays:xs.length};
}
// iOS/Android 각각의 예측기 외에, 전체(iOS+Android 풀링) 차트용 예측기(ALL)도 함께 준비.
const GROWTH_PREDICTOR={iOS:buildGrowthPredictor(["iOS"]),Android:buildGrowthPredictor(["Android"]),ALL:buildGrowthPredictor(["iOS","Android"])};
// predictor 기준 "D1 대비 k일 시점 증분율(%)" — growthSlopeChart와 동일한 D1 베이스라인 기준을 사용.
function predictedGrowthPct(predictor,k){
  if(!predictor)return null;
  const p1=predictor.predict(1), pk=predictor.predict(k);
  return (p1==null||pk==null)?null:pk-p1;
}

// 지표별 성숙 소요일(D1=1일,D3=3일,D7=7일) 미만인 최근 코호트는 라인에서 제외(끊어짐)해 미완성치로 곡선이 왜곡되지 않게 한다.
function seriesFrom(byDateMap,key,minDays,label,color){
  return { label, color,
    valid:d=>daysAgo(d)>=minDays && byDateMap[d] && byDateMap[d][key]!=null,
    get:d=>byDateMap[d][key],
  };
}
// seriesFrom + 미도래 구간(코호트가 아직 그 일수까지 자라지 않은 최근 설치일) 예측 확장.
// 예측은 growthSlopeChart와 동일한 방식: 해당 설치일의 실측 D1 ROAS에, OS 단위 로그 성장 곡선에서
// 뽑은 "D1 대비 k일 증분율"만큼을 얹어 추정한다. D1 자체(minDays=1)는 예측 대상에서 제외(기준선이므로).
function seriesFromWithPredict(byDateMap,key,minDays,label,color,predictor,dayK){
  const base=seriesFrom(byDateMap,key,minDays,label,color);
  if(dayK<=1)return base;
  const gPct=predictedGrowthPct(predictor,dayK);
  if(gPct==null)return base;
  return { ...base,
    predValid:d=>!base.valid(d) && daysAgo(d)>=1 && byDateMap[d] && byDateMap[d].roas_d1!=null,
    predGet:d=>byDateMap[d].roas_d1*(1+gPct/100),
  };
}
// 공통 라인차트: X축=설치일(하단), 각 series(D1/D3/D7 등)를 뚜렷한 색상의 꺾은선+마크+수치 레이블로 표현
// series 순서(뒤에 올수록 값이 위에 있다고 가정 — D1<D3<D7)를 이용해 레이블을 위/아래로 살짝 엇갈려 겹침을 줄인다.
function dailyLineChart(dates,seriesDefs,fmt,opts={}){
  const W=opts.W||760,H=opts.H||260,padL=46,padR=16,padT=16,padB=28;
  const plotW=W-padL-padR, plotH=H-padT-padB, n=dates.length;
  const xOf=i=>n>1?padL+plotW*i/(n-1):padL+plotW/2;
  const allVals=seriesDefs.flatMap(s=>dates.flatMap(d=>{
    const vs=[];
    if(s.valid(d))vs.push(s.get(d));
    if(s.predValid&&s.predValid(d))vs.push(s.predGet(d));
    return vs;
  }));
  const maxV=allVals.length?Math.max(...allVals,0):1;
  const yOf=v=>padT+plotH-(v/(maxV||1))*plotH;
  const showEvery=Math.max(1,Math.ceil(n/12));
  let content="";
  seriesDefs.forEach((s,si)=>{
    let path="",marks="",labels="",lastIdx=-1;
    dates.forEach((d,i)=>{
      if(!s.valid(d))return;
      const v=s.get(d), x=xOf(i), y=yOf(v);
      path+=(path?"L":"M")+x.toFixed(1)+","+y.toFixed(1)+" ";
      marks+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="${s.color}" stroke="var(--surf)" stroke-width="1"><title>${escXml(d)} ${escXml(s.label)}: ${fmt(v)}</title></circle>`;
      if(i%showEvery===0)labels+=`<text x="${x.toFixed(1)}" y="${(y-6-si*10).toFixed(1)}" font-size="8" fill="${s.color}" text-anchor="middle">${fmt(v)}</text>`;
      lastIdx=i;
    });
    if(path)content+=`<path d="${path.trim()}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    content+=marks+labels;
    // 예측 구간(점선) — 실측 마지막 지점에서 이어붙여, 아직 도래하지 않은 코호트 기간을 추정 표시.
    if(s.predValid&&lastIdx>=0){
      let predPath=`M${xOf(lastIdx).toFixed(1)},${yOf(s.get(dates[lastIdx])).toFixed(1)} `;
      let predMarks="",hasPred=false;
      for(let i=lastIdx+1;i<n;i++){
        const d=dates[i];
        if(!s.predValid(d))break;
        const v=s.predGet(d), x=xOf(i), y=yOf(v);
        predPath+=`L${x.toFixed(1)},${y.toFixed(1)} `;
        predMarks+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="var(--surf)" stroke="${s.color}" stroke-width="1.6"><title>${escXml(d)} ${escXml(s.label)}(예측): ${fmt(v)}</title></circle>`;
        if(i%showEvery===0)predMarks+=`<text x="${x.toFixed(1)}" y="${(y-6-si*10).toFixed(1)}" font-size="8" fill="${s.color}" text-anchor="middle" font-style="italic">${fmt(v)}*</text>`;
        hasPred=true;
      }
      if(hasPred)content+=`<path d="${predPath.trim()}" fill="none" stroke="${s.color}" stroke-width="2" stroke-dasharray="5,4" stroke-linecap="round" opacity="0.75"/>`+predMarks;
    }
  });
  const yTicks=[0,0.5,1].map(f=>{
    const v=maxV*f, y=yOf(v);
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W-padR}" y2="${y.toFixed(1)}" stroke="var(--grid)" stroke-width="1"/><text x="${padL-6}" y="${(y+3).toFixed(1)}" font-size="9" fill="var(--muted)" text-anchor="end">${fmt(v)}</text>`;
  }).join("");
  const xLabels=dates.map((d,i)=>i%showEvery===0?`<text x="${xOf(i).toFixed(1)}" y="${H-8}" font-size="9" fill="var(--muted)" text-anchor="middle">${escXml(d.slice(5))}</text>`:"").join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="cohort-chart${opts.cls?' '+opts.cls:''}" preserveAspectRatio="xMidYMid meet">${yTicks}${content}${xLabels}</svg>`;
}
function chartLegendSSR(items){
  return `<div class="chart-legend">`+items.map(it=>`<span class="lg"><span class="ln" style="background:${it.color}"></span>${escXml(it.label)}</span>`).join("")+`</div>`;
}
const D1D3D7_LEGEND=chartLegendSSR([
  {label:"D1",color:"var(--d1)"},{label:"D3",color:"var(--d3)"},{label:"D7",color:"var(--d7)"},
  {label:"D14",color:"var(--d14)"},{label:"D21",color:"var(--d21)"},{label:"D30",color:"var(--d30)"},
]);

// ① 전체(국가·매체 합산) 일자별 D1/D3/D7/D14/D21/D30 ROAS 추이 — 섹션 전체 폭을 채우는 와이드 차트
const ROAS_LINE_CHART=dailyLineChart(CHART_DATES,[
  seriesFrom(DAILY_AGG_MAP,"roas_d1",1,"D1","var(--d1)"),
  seriesFromWithPredict(DAILY_AGG_MAP,"roas_d3",3,"D3","var(--d3)",GROWTH_PREDICTOR.ALL,3),
  seriesFromWithPredict(DAILY_AGG_MAP,"roas_d7",7,"D7","var(--d7)",GROWTH_PREDICTOR.ALL,7),
  seriesFromWithPredict(DAILY_AGG_MAP,"roas_d14",14,"D14","var(--d14)",GROWTH_PREDICTOR.ALL,14),
  seriesFromWithPredict(DAILY_AGG_MAP,"roas_d21",21,"D21","var(--d21)",GROWTH_PREDICTOR.ALL,21),
  seriesFromWithPredict(DAILY_AGG_MAP,"roas_d30",30,"D30","var(--d30)",GROWTH_PREDICTOR.ALL,30),
],fmtPct,{W:1400,H:220,cls:"cohort-chart-wide"});

// ② 국가별 × OS별 일자별 D1/D3/D7/D14/D21/D30 ROAS 추이 (Cost 상위 9개국, iOS 좌 / Android 우)
function countryOsDaily(country,os){
  const byDate={};
  for(const d of CHART_DATES)byDate[d]={cost:0,rev_d1:0,rev_d3:0,rev_d7:0,rev_d14:0,rev_d21:0,rev_d30:0};
  for(const r of CHART_ROWS){
    if(r.country!==country||r.os!==os)continue;
    const b=byDate[r.date]; if(!b)continue;
    b.cost+=r.cost; b.rev_d1+=r.rev_d1; b.rev_d3+=r.rev_d3; b.rev_d7+=(r.rev_d7||0);
    b.rev_d14+=(r.rev_d14||0); b.rev_d21+=(r.rev_d21||0); b.rev_d30+=(r.rev_d30||0);
  }
  const map={};
  for(const d of CHART_DATES){
    const b=byDate[d];
    map[d]={
      roas_d1:b.cost>0?b.rev_d1/b.cost*100:null,
      roas_d3:b.cost>0?b.rev_d3/b.cost*100:null,
      roas_d7:b.cost>0&&b.rev_d7>0?b.rev_d7/b.cost*100:null,
      roas_d14:b.cost>0&&b.rev_d14>0?b.rev_d14/b.cost*100:null,
      roas_d21:b.cost>0&&b.rev_d21>0?b.rev_d21/b.cost*100:null,
      roas_d30:b.cost>0&&b.rev_d30>0?b.rev_d30/b.cost*100:null,
    };
  }
  return map;
}
function countryOsChart(country,os){
  const map=countryOsDaily(country,os);
  const predictor=GROWTH_PREDICTOR[os];
  return dailyLineChart(CHART_DATES,[
    seriesFrom(map,"roas_d1",1,"D1","var(--d1)"),
    seriesFromWithPredict(map,"roas_d3",3,"D3","var(--d3)",predictor,3),
    seriesFromWithPredict(map,"roas_d7",7,"D7","var(--d7)",predictor,7),
    seriesFromWithPredict(map,"roas_d14",14,"D14","var(--d14)",predictor,14),
    seriesFromWithPredict(map,"roas_d21",21,"D21","var(--d21)",predictor,21),
    seriesFromWithPredict(map,"roas_d30",30,"D30","var(--d30)",predictor,30),
  ],fmtPct);
}
// WW(SKAN)는 캠페인명 기반 coarse 국가 귀속이라 국가·OS별 일자별 코호트 추이를 볼 수 없어 이 섹션에서만 제외.
const COUNTRY_OS_SECTIONS=TOP_COUNTRIES.filter(c=>c!=="WW").map(c=>`
  <div class="country-row">
    <div class="country-charts">
      <div class="chart-panel"><div class="chart-panel-title-lg" style="color:${countryColor(c)}">${escXml(countryLabelSSR(c))} iOS</div>${countryOsChart(c,"iOS")}</div>
      <div class="chart-panel"><div class="chart-panel-title-lg" style="color:${countryColor(c)}">${escXml(countryLabelSSR(c))} Android</div>${countryOsChart(c,"Android")}</div>
    </div>
  </div>`).join("");

// ③ 국가별 × OS별 ROAS 증분율(%) — D1 기준(0%) 대비 D3/D7/D14/D21/D30.
// 시점(minDays)마다 실제로 그 시점까지 성숙한 코호트(설치일) 집합이 다르므로(예: D30은 아직 성숙한
// 코호트가 없을 수 있음), 각 시점을 독자적인 성숙 코호트 집합으로 집계한다 — 데이터가 아직 없는
// 시점은 해당 포인트만 비워두고(라인 전체가 아니라) 그래프/표에 표시하지 않는다.
function countryOsMatureAggFor(country,osList,minDays){
  const list=Array.isArray(osList)?osList:[osList];
  let cost=0,rev_d1=0,rev_d3=0,rev_d7=0,rev_d14=0,rev_d21=0,rev_d30=0;
  for(const r of CHART_ROWS){
    if(r.country!==country||!list.includes(r.os)||daysAgo(r.date)<minDays)continue;
    cost+=r.cost; rev_d1+=r.rev_d1; rev_d3+=r.rev_d3; rev_d7+=(r.rev_d7||0);
    rev_d14+=(r.rev_d14||0); rev_d21+=(r.rev_d21||0); rev_d30+=(r.rev_d30||0);
  }
  return {
    cost,
    roas_d1:cost>0?rev_d1/cost*100:null,
    roas_d3:cost>0?rev_d3/cost*100:null,
    roas_d7:cost>0&&rev_d7>0?rev_d7/cost*100:null,
    roas_d14:cost>0&&rev_d14>0?rev_d14/cost*100:null,
    roas_d21:cost>0&&rev_d21>0?rev_d21/cost*100:null,
    roas_d30:cost>0&&rev_d30>0?rev_d30/cost*100:null,
  };
}
// osKey: "iOS" | "Android" | "ALL"(iOS+Android 풀링) — 국가별 D1/D3/D7/D14/D21/D30 실측·예측 엔트리를 계산.
// 이 엔트리 하나로 절대 ROAS(%) 차트와 D1 대비 증분율(%) 차트를 둘 다 그릴 수 있다.
function computeCohortEntries(osKey){
  const osList=osKey==="ALL"?["iOS","Android"]:[osKey];
  const DAY_OF=[1,3,7,14,21,30];
  const predictor=GROWTH_PREDICTOR[osKey];
  const excluded=[];
  const entries=TOP_COUNTRIES.map(c=>{
    // D1/D3/D7은 기존과 동일하게 7일 성숙 코호트 집합 하나로 함께 계산(변경 없음).
    const base=countryOsMatureAggFor(c,osList,7);
    if(base.roas_d1==null||base.roas_d1<=0){excluded.push(c);return null;}
    const g3=base.roas_d3!=null?(base.roas_d3-base.roas_d1)/base.roas_d1*100:null;
    const g7=base.roas_d7!=null?(base.roas_d7-base.roas_d1)/base.roas_d1*100:null;
    // D14/D21/D30은 각각 그 시점 기준 성숙 코호트 집합에서 자체 D1 대비 증분을 계산(위 주석 참고).
    const a14=countryOsMatureAggFor(c,osList,14);
    const a21=countryOsMatureAggFor(c,osList,21);
    const a30=countryOsMatureAggFor(c,osList,30);
    const g14=(a14.roas_d1!=null&&a14.roas_d1>0&&a14.roas_d14!=null)?(a14.roas_d14-a14.roas_d1)/a14.roas_d1*100:null;
    const g21=(a21.roas_d1!=null&&a21.roas_d1>0&&a21.roas_d21!=null)?(a21.roas_d21-a21.roas_d1)/a21.roas_d1*100:null;
    const g30=(a30.roas_d1!=null&&a30.roas_d1>0&&a30.roas_d30!=null)?(a30.roas_d30-a30.roas_d1)/a30.roas_d1*100:null;
    const realG=[0,g3,g7,g14,g21,g30];
    // g14/g21/g30은 각각 a14/a21/a30 population 자체의 D1 기준(baseline)이 서로 다르다(성숙 문턱이
    // 다른 별도 코호트 집합이므로) — 예측치를 절대 ROAS%로 되돌릴 때는 반드시 그 growth%를 만들어낸
    // "바로 그 population"의 D1 기준을 함께 써야 한다(다른 population의 기준을 섞으면 값이 왜곡된다).
    const baselineByIdx=[base.roas_d1,base.roas_d1,base.roas_d1,a14.roas_d1,a21.roas_d1,a30.roas_d1];
    // 마지막 실측 지점 이후는 전부 예측 대상으로 본다(코호트 성숙은 시간이 지날수록만 늘어나므로 단조적).
    let lastIdx=0,lastVal=0,lastBaseline=base.roas_d1;
    for(let i=1;i<realG.length;i++){ if(realG[i]!=null){ lastIdx=i; lastVal=realG[i]; lastBaseline=baselineByIdx[i]; } else break; }
    const predG=[null,null,null,null,null,null];
    for(let i=lastIdx+1;i<realG.length;i++){
      const p=predictor.predict(DAY_OF[i]), pAnchor=predictor.predict(DAY_OF[lastIdx]);
      predG[i]=(p!=null&&pAnchor!=null)?lastVal+(p-pAnchor):null;
    }
    const roasFromG=g=>(g!=null&&lastBaseline!=null&&lastBaseline>0)?lastBaseline*(1+g/100):null;
    return {
      country:c,color:countryColor(c),pts:realG,predPts:predG,lastIdx,
      cost:base.cost,
      roas_d1:base.roas_d1,roas_d3:base.roas_d3,roas_d7:base.roas_d7,
      roas_d14:g14!=null?a14.roas_d14:roasFromG(predG[3]), roas_d14_pred:g14==null&&predG[3]!=null,
      roas_d21:g21!=null?a21.roas_d21:roasFromG(predG[4]), roas_d21_pred:g21==null&&predG[4]!=null,
      roas_d30:g30!=null?a30.roas_d30:roasFromG(predG[5]), roas_d30_pred:g30==null&&predG[5]!=null,
      g3,g7,
      g14:g14??predG[3], g21:g21??predG[4], g30:g30??predG[5],
    };
  }).filter(Boolean);
  return {osKey,plotted:entries.map(e=>e.country),excluded,entries};
}
// 국가별 라인 하나를 그리는 공통 루틴 — getReal/getPred(e,j)로 절대 ROAS 차트/증분율 차트가 같은 그리기
// 로직(실선→마지막 실측 지점에서 점선 예측 이어붙이기)을 공유한다.
function renderCohortSeries(entries,N,LABELS,xs,yOf,getReal,getPred,fmtV){
  let lines="";
  for(const e of entries){
    let path="",lastIdx=-1;
    for(let j=0;j<N;j++){
      const v=getReal(e,j);
      if(v==null)break;
      const x=xs[j],y=yOf(v);
      path+=(path?"L":"M")+x.toFixed(1)+","+y.toFixed(1)+" ";
      lastIdx=j;
    }
    if(path)lines+=`<path d="${path.trim()}" fill="none" stroke="${e.color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
    for(let j=0;j<=lastIdx;j++){
      const v=getReal(e,j),x=xs[j],y=yOf(v);
      lines+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4" fill="${e.color}" stroke="var(--surf)" stroke-width="1.5"><title>${escXml(countryLabelSSR(e.country))} ${LABELS[j]}: ${fmtV(v)}</title></circle>`;
      if(j>0)lines+=`<text x="${x.toFixed(1)}" y="${(y-7).toFixed(1)}" font-size="9" fill="${e.color}" text-anchor="middle">${fmtV(v)}</text>`;
    }
    if(lastIdx>=0){
      let predPath=`M${xs[lastIdx].toFixed(1)},${yOf(getReal(e,lastIdx)).toFixed(1)} `;
      let hasPred=false;
      for(let j=lastIdx+1;j<N;j++){
        const pv=getPred(e,j);
        if(pv==null)break;
        predPath+=`L${xs[j].toFixed(1)},${yOf(pv).toFixed(1)} `;
        hasPred=true;
      }
      if(hasPred)lines+=`<path d="${predPath.trim()}" fill="none" stroke="${e.color}" stroke-width="2" stroke-dasharray="5,4" stroke-linecap="round" opacity="0.75"/>`;
      for(let j=lastIdx+1;j<N;j++){
        const pv=getPred(e,j); if(pv==null)continue;
        const x=xs[j],y=yOf(pv);
        lines+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4" fill="var(--surf)" stroke="${e.color}" stroke-width="1.8"><title>${escXml(countryLabelSSR(e.country))} ${LABELS[j]}(예측): ${fmtV(pv)}</title></circle>`;
        lines+=`<text x="${x.toFixed(1)}" y="${(y-7).toFixed(1)}" font-size="9" fill="${e.color}" text-anchor="middle" font-style="italic">${fmtV(pv)}*</text>`;
      }
    }
    for(let j=N-1;j>=0;j--){
      const v=getReal(e,j)??getPred(e,j);
      if(v!=null){ lines+=`<text x="${(xs[j]+8).toFixed(1)}" y="${(yOf(v)+4).toFixed(1)}" font-size="10" fill="${e.color}" font-weight="700">${escXml(countryLabelSSR(e.country))}</text>`; break; }
    }
  }
  return lines;
}
// 국가별 × OS별 ROAS 증분율(%) — D1 기준(0%) 대비 D3/D7/D14/D21/D30.
function renderGrowthChart(data){
  const {entries,excluded}=data;
  if(!entries.length)return '<p class="tabnote">완성된(설치 후 7일 경과) 코호트 데이터가 부족해 표시할 국가가 없습니다.</p>';
  const W=900,H=280,padL=46,padR=54,padT=16,padB=30;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const LABELS=["D1(기준 0%)","D3","D7","D14","D21","D30"];
  const N=LABELS.length;
  const xs=Array.from({length:N},(_,i)=>padL+plotW*i/(N-1));
  const vals=entries.flatMap(e=>[...e.pts,...e.predPts]).filter(v=>v!=null);
  const maxV=vals.length?Math.max(...vals,0):1, minV=vals.length?Math.min(...vals,0):0;
  const range=(maxV-minV)||1;
  const yOf=v=>padT+plotH-((v-minV)/range)*plotH;
  const fmtV=v=>v.toFixed(0)+"%";
  const lines=renderCohortSeries(entries,N,LABELS,xs,yOf,(e,j)=>e.pts[j],(e,j)=>e.predPts[j],fmtV);
  const zeroY=yOf(0);
  const zeroLine=`<line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${W-padR}" y2="${zeroY.toFixed(1)}" stroke="var(--grid)" stroke-width="1" stroke-dasharray="3,3"/>`;
  const axisLabels=LABELS.map((l,i)=>`<text x="${xs[i]}" y="${H-8}" font-size="10" fill="var(--muted)" text-anchor="middle">${l}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="cohort-chart">${zeroLine}${lines}${axisLabels}</svg>`;
}
// 국가별 × OS별 절대 ROAS(%) — D1/D3/D7/D14/D21/D30 시점 각각의 실제(또는 예측) 누적 ROAS 값 자체.
function renderAbsoluteChart(data){
  const {entries}=data;
  if(!entries.length)return '<p class="tabnote">완성된(설치 후 7일 경과) 코호트 데이터가 부족해 표시할 국가가 없습니다.</p>';
  const W=900,H=280,padL=46,padR=54,padT=16,padB=30;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const LABELS=["D1","D3","D7","D14","D21","D30"];
  const N=LABELS.length;
  const xs=Array.from({length:N},(_,i)=>padL+plotW*i/(N-1));
  const absAll=e=>[e.roas_d1,e.roas_d3,e.roas_d7,e.roas_d14,e.roas_d21,e.roas_d30];
  const isPred=e=>[false,false,false,e.roas_d14_pred,e.roas_d21_pred,e.roas_d30_pred];
  const getReal=(e,j)=>isPred(e)[j]?null:absAll(e)[j];
  const getPred=(e,j)=>isPred(e)[j]?absAll(e)[j]:null;
  const vals=entries.flatMap(e=>absAll(e)).filter(v=>v!=null);
  const maxV=vals.length?Math.max(...vals,0):1;
  const yOf=v=>padT+plotH-(v/(maxV||1))*plotH;
  const fmtV=v=>v.toFixed(0)+"%";
  const lines=renderCohortSeries(entries,N,LABELS,xs,yOf,getReal,getPred,fmtV);
  const yTicks=[0,0.5,1].map(f=>{
    const v=maxV*f,y=yOf(v);
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W-padR}" y2="${y.toFixed(1)}" stroke="var(--grid)" stroke-width="1"/><text x="${padL-6}" y="${(y+3).toFixed(1)}" font-size="9" fill="var(--muted)" text-anchor="end">${fmtPct(v)}</text>`;
  }).join("");
  const axisLabels=LABELS.map((l,i)=>`<text x="${xs[i]}" y="${H-8}" font-size="10" fill="var(--muted)" text-anchor="middle">${l}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="cohort-chart">${yTicks}${lines}${axisLabels}</svg>`;
}
function growthLegendAndNote(result){
  const legend=chartLegendSSR(TOP_COUNTRIES.filter(c=>result.plotted.includes(c)).map(c=>({label:countryLabelSSR(c),color:countryColor(c)})));
  // WW(SKAN)는 원래 이 차트에서 제외 대상이 맞으므로 "제외" 표시에서도 빼고, 나머지는 국가코드만 표시(사유 텍스트 없음).
  const excluded=result.excluded.filter(c=>c!=="WW");
  const note=excluded.length?`<div class="tabnote">제외: ${excluded.map(countryLabelSSR).join(", ")}</div>`:"";
  return legend+note;
}
// 그래프가 겹쳐 읽기 어려운 문제(사용자 피드백) 보완용 — 같은 데이터를 국가별 표로도 제공.
// Cost 내림차순 정렬(사용자 요청).
function cohortRowsSSR(entries){
  if(!entries.length)return `<tr><td colspan="13" class="na">표시할 국가 없음</td></tr>`;
  const sorted=entries.slice().sort((a,b)=>b.cost-a.cost);
  const fmtSigned=v=>v==null?"–":(v>=0?"+":"")+v.toFixed(1)+"%";
  // 예측치는 "값*" + 이탤릭으로 표시해 실측과 구분한다.
  const cellPct=(v,isPred)=>v==null?"–":`<span${isPred?' class="pred"':''}>${fmtPct(v)}${isPred?"*":""}</span>`;
  const cellSigned=(v,isPred)=>v==null?"–":`<span${isPred?' class="pred"':''}>${fmtSigned(v)}${isPred?"*":""}</span>`;
  return sorted.map(e=>`<tr>
    <td class="left"><span class="dot" style="background:${e.color}"></span>${escXml(countryLabelSSR(e.country))}</td>
    <td>${fmtDollar(e.cost)}</td>
    <td>${fmtPct(e.roas_d1)}</td>
    <td>${fmtPct(e.roas_d3)}</td>
    <td>${fmtPct(e.roas_d7)}</td>
    <td>${cellPct(e.roas_d14,e.roas_d14_pred)}</td>
    <td>${cellPct(e.roas_d21,e.roas_d21_pred)}</td>
    <td>${cellPct(e.roas_d30,e.roas_d30_pred)}</td>
    <td>${fmtSigned(e.g3)}</td>
    <td>${fmtSigned(e.g7)}</td>
    <td>${cellSigned(e.g14,e.roas_d14_pred)}</td>
    <td>${cellSigned(e.g21,e.roas_d21_pred)}</td>
    <td>${cellSigned(e.g30,e.roas_d30_pred)}</td>
  </tr>`).join("");
}
// OS(통합/iOS/Android)를 세로 드릴다운이 아니라 가로 탭으로 전환(사용자 요청) — 기본값은 통합.
const COHORT_TABLE_ORDER=[{key:"ALL",label:"통합(iOS+Android)"},{key:"iOS",label:"iOS"},{key:"Android",label:"Android"}];
function cohortTableTabs(){
  const tabs=`<div class="metric-filter">`+COHORT_TABLE_ORDER.map(({key,label},i)=>
    `<button class="btn cm-filter-btn${i===0?" active":""}" id="ctt-btn-${key}" onclick="cohortTableTab('${key}')">${escXml(label)}</button>`
  ).join("")+`</div>`;
  const bodies=COHORT_TABLE_ORDER.map(({key},i)=>`<tbody id="ctt-${key}" style="display:${i===0?"":"none"}">${cohortRowsSSR(COHORT_DATA[key].entries)}</tbody>`).join("");
  return `${tabs}<div class="cohort-table-wrap"><table>
    <thead><tr><th class="left">국가</th><th>Cost</th><th>D1 ROAS(기준)</th><th>D3 ROAS</th><th>D7 ROAS</th><th>D14 ROAS</th><th>D21 ROAS</th><th>D30 ROAS</th><th>D3 증분율</th><th>D7 증분율</th><th>D14 증분율</th><th>D21 증분율</th><th>D30 증분율</th></tr></thead>
    ${bodies}
  </table></div>`;
}
const COHORT_OS_KEYS=[{key:"iOS",label:"iOS"},{key:"Android",label:"Android"},{key:"ALL",label:"통합(iOS+Android)"}];
const COHORT_DATA={};for(const {key} of COHORT_OS_KEYS)COHORT_DATA[key]=computeCohortEntries(key);
const COHORT_ABS_SVG={},COHORT_GROWTH_SVG={},COHORT_LEGEND={};
for(const {key} of COHORT_OS_KEYS){
  COHORT_ABS_SVG[key]=renderAbsoluteChart(COHORT_DATA[key]);
  COHORT_GROWTH_SVG[key]=renderGrowthChart(COHORT_DATA[key]);
  COHORT_LEGEND[key]=growthLegendAndNote(COHORT_DATA[key]);
}
const COHORT_MERGED_TABLE=cohortTableTabs();
// 두 차트(절대 ROAS/증분율)의 플랫폼 필터 버튼 — 기본값은 통합(iOS+Android).
function cohortFilterBar(scope){
  return `<div class="metric-filter">`+COHORT_OS_KEYS.map(({key,label})=>
    `<button class="btn cm-filter-btn${key==="ALL"?" active":""}" id="cm-${scope}-btn-${key}" onclick="cohortMetricFilter('${scope}','${key}')">${escXml(label)}</button>`
  ).join("")+`</div>`;
}
function cohortViewPanels(scope,svgMap){
  return COHORT_OS_KEYS.map(({key})=>
    `<div class="cm-view" id="cm-${scope}-${key}" style="display:${key==="ALL"?"":"none"}">${COHORT_LEGEND[key]}${svgMap[key]}</div>`
  ).join("");
}

const html = `<title>국가/OS/매체/캠페인/일자별 성과 — Idol Farm Life</title>
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
.bar{display:flex;gap:14px;align-items:center;margin-bottom:10px;flex-wrap:wrap;}
.barsec{display:flex;gap:8px;align-items:center;}
.barsec-label{font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em;margin-right:2px;}
.bar-divider{width:1px;align-self:stretch;background:var(--border2);}
.btn{background:var(--surf);border:1px solid var(--border2);color:var(--muted);border-radius:4px;padding:5px 11px;font-size:11.5px;cursor:pointer;}
.btn:hover{color:var(--txt);}
.tw{overflow-x:auto;border:1px solid var(--border);border-radius:6px;max-height:78vh;}
table{border-collapse:collapse;width:100%;font-size:12px;}
th,td{padding:6px 10px;text-align:right;border-bottom:1px solid var(--border);font-variant-numeric:tabular-nums;}
td{white-space:nowrap;}
th{background:var(--surf2);color:var(--muted);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.03em;position:sticky;top:0;z-index:2;white-space:normal;vertical-align:bottom;line-height:1.25;}
td.left,th.left{text-align:left;}
.node{cursor:pointer;user-select:none;}
.node:hover{background:var(--surf);}
.caret{display:inline-block;width:14px;color:var(--muted);font-size:9px;transition:transform .12s;}
.leaf .caret{visibility:hidden;}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;}
.os-pill{display:inline-block;font-size:10px;padding:1px 6px;border-radius:10px;border:1px solid var(--border2);}
.os-iOS{color:#7dd3fc;}.os-Android{color:#86efac;}
.po-pill{display:inline-block;font-size:10px;padding:1px 8px;border-radius:10px;font-weight:700;text-transform:uppercase;letter-spacing:.02em;}
.po-paid{background:rgba(78,158,255,.16);color:#9ecbff;}
.po-organic{background:rgba(125,133,144,.16);color:#b0b6bd;}
.ctype-pill{display:inline-block;font-size:10px;padding:1px 8px;border-radius:10px;border:1px solid var(--border2);font-weight:700;text-transform:uppercase;letter-spacing:.02em;}
.topspend-hint{font-size:11.5px;color:var(--muted);background:var(--surf);border:1px dashed var(--border2);border-radius:6px;padding:10px 12px;margin-bottom:14px;}
.topspend-head{font-size:13px;font-weight:800;margin-bottom:8px;color:var(--txt);}
.topspend-week{font-size:11px;font-weight:500;color:var(--muted);}
.topspend-wrap{overflow-x:auto;border:2px solid var(--accent);border-radius:8px;margin-bottom:16px;box-shadow:0 0 0 4px rgba(78,158,255,.08);}
.topspend-tbl{border-collapse:collapse;width:100%;font-size:12px;}
.topspend-tbl th,.topspend-tbl td{padding:7px 12px;text-align:right;border-bottom:1px solid var(--border);white-space:nowrap;font-variant-numeric:tabular-nums;}
.topspend-tbl td.left,.topspend-tbl th.left{text-align:left;}
.topspend-tbl thead th{background:rgba(78,158,255,.14);color:var(--accent);font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.03em;}
.topspend-tbl tbody tr:hover{background:var(--surf2);}
.topspend-tbl tbody tr:nth-child(1) td.topspend-cost{color:#ffd166;}
.topspend-cost{font-weight:800;color:var(--txt);}
.lvl0{font-weight:700;}
.lvl0 td{background:rgba(78,158,255,.06);}
.lvl1 td{background:rgba(255,255,255,.015);}
tr.grand-total td{position:sticky;top:var(--head-h,34px);z-index:1;background:rgba(78,158,255,.16);font-weight:800;border-top:2px solid var(--accent);border-bottom:2px solid var(--accent);}
tr.grand-total td.left{color:var(--accent);}
.na{color:var(--dim);}.pos{color:var(--good);}.mid{color:var(--warn);}
.dd{position:relative;}
.ddbtn{display:inline-flex;align-items:center;gap:6px;}
#ddcount{color:var(--accent);font-weight:700;}
.ddpanel{display:none;position:absolute;top:calc(100% + 4px);left:0;z-index:20;background:var(--surf);border:1px solid var(--border2);border-radius:6px;padding:8px;min-width:200px;box-shadow:0 8px 24px rgba(0,0,0,.5);}
.ddpanel.open{display:block;}
.ddhead{display:flex;gap:6px;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid var(--border);}
.ddhead button{flex:1;font-size:10.5px;padding:3px;background:var(--surf2);border:1px solid var(--border2);color:var(--muted);border-radius:3px;cursor:pointer;}
.ddhead button:hover{color:var(--txt);}
.ddgrid{display:grid;grid-template-columns:1fr 1fr;gap:2px;max-height:260px;overflow:auto;}
.ddi{display:flex;align-items:center;gap:6px;font-size:11.5px;padding:3px 6px;border-radius:4px;cursor:pointer;color:var(--txt);}
.ddi:hover{background:var(--surf2);}
.ddi input{accent-color:var(--accent);}
.ddi.nodata{color:var(--dim);}
.ddsearch{width:100%;box-sizing:border-box;padding:5px 8px;margin-bottom:6px;background:var(--surf2);border:1px solid var(--border2);border-radius:4px;color:var(--txt);font-size:11.5px;}
.ddsearch:focus{outline:none;border-color:var(--accent);}
.ddempty{padding:8px;color:var(--dim);font-size:11px;grid-column:1/-1;}
.note{margin-bottom:14px;font-size:11px;color:var(--muted);background:var(--surf);border:1px solid var(--border);border-left:3px solid var(--warn);border-radius:4px;padding:9px 12px;line-height:1.6;}
.note-head{font-size:10px;font-weight:800;letter-spacing:.08em;color:var(--warn);margin-bottom:6px;}
.note p{margin:3px 0;}
.segwrap{display:flex;align-items:center;gap:6px;margin-bottom:10px;flex-wrap:wrap;}
.seglabel{font-size:11px;color:var(--muted);margin-right:2px;}
.segbar{display:flex;align-items:stretch;gap:0;flex-wrap:wrap;}
.chip{display:flex;align-items:center;gap:6px;background:var(--surf);border:1px solid var(--border2);border-radius:5px;padding:4px 4px 4px 9px;cursor:grab;user-select:none;transition:opacity .12s,border-color .12s;}
.chip:active{cursor:grabbing;}
.chip.dragging{opacity:.35;}
.chip.over{border-color:var(--accent);}
.chip-num{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:var(--accent);color:#0D1117;font-size:9px;font-weight:700;}
.chip-label{font-size:11.5px;font-weight:600;}
.chip-btns{display:flex;gap:1px;margin-left:2px;}
.chip-btn{background:var(--surf2);border:1px solid var(--border2);color:var(--muted);border-radius:3px;width:16px;height:16px;font-size:9px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;}
.chip-btn:hover:not(:disabled){color:var(--txt);border-color:var(--accent);}
.chip-btn:disabled{opacity:.25;cursor:default;}
.seg-arrow{display:flex;align-items:center;color:var(--dim);font-size:12px;padding:0 4px;}
.camp{max-width:260px;overflow:hidden;text-overflow:ellipsis;display:inline-block;vertical-align:middle;}
/* 컬럼 그룹별 헤더 색상 (sticky 헤더라 불투명한 진한 톤 사용) */
th.th-blue{background:#16324f;color:#9ecbff;}
th.th-blue-dark{background:#1f6feb;color:#ffffff;font-weight:800;}
th.th-pink{background:#3f2233;color:#ff9ec4;}
th.th-purple{background:#2d1f4f;color:#c9a8ff;}
th.th-green{background:#1c3a1e;color:#a3e88a;}
th.th-yellow{background:#4a3a12;color:#ffd966;}
th.th-toggle-parent{cursor:pointer;}
th.th-toggle-parent:hover{filter:brightness(1.2);}
.th-caret{display:inline-block;width:11px;font-size:9px;transition:transform .12s;color:inherit;}
/* 탭 */
.tabbar{display:flex;gap:2px;padding:0 18px;background:var(--surf);border-bottom:1px solid var(--border);}
.tabbtn{background:transparent;border:none;border-bottom:2px solid transparent;color:var(--muted);padding:10px 14px 8px;font-size:12.5px;font-weight:600;cursor:pointer;}
.tabbtn:hover{color:var(--txt);}
.tabbtn.active{color:var(--txt);border-bottom-color:var(--accent);}
.tabpanel{display:none;}
.tabpanel.active{display:block;}
/* 차트 공통 */
:root{
  --c-install:#3987e5;--c-iaa:#199e70;--c-iap:#c98500;--c-cpi:#008300;--c-roas:#9085e9;
  --grid:#2c2c2a;
  --d1:#4E9EFF;--d3:#F2A93C;--d7:#F85149;--d14:#A78BFA;--d21:#2DD4BF;--d30:#F472B6;
}
.chart-legend{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:12px;font-size:11px;color:var(--muted);}
.chart-legend .lg{display:inline-flex;align-items:center;gap:5px;}
.chart-legend .sw{width:9px;height:9px;border-radius:2px;display:inline-block;}
.chart-legend .ln{width:12px;height:2px;border-radius:1px;display:inline-block;}
.summary-list{display:flex;flex-direction:column;gap:12px;}
.country-row{background:var(--surf);border:1px solid var(--border);border-radius:6px;padding:10px 12px 6px;}
.country-row-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;}
.country-row-title{font-size:12.5px;font-weight:700;}
.country-row-sub{font-size:10.5px;color:var(--muted);}
.country-charts{display:flex;gap:16px;flex-wrap:wrap;}
.chart-panel{flex:1 1 420px;min-width:320px;}
/* 좌/우 두 그래프의 제목·설명·필터·차트 각 줄을 그리드 행으로 맞춰, 설명 텍스트 길이가 달라도
   차트 시작 위치가 항상 같은 높이에서 시작하게 한다(사용자 피드백 — 우측 설명이 길어 차트가 밀림). */
.country-charts.cohort-2col{display:grid;grid-template-columns:1fr 1fr;column-gap:16px;row-gap:0;align-items:start;}
.chart-panel-title{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;margin-bottom:2px;}
.chart-panel-title-lg{font-size:13px;font-weight:700;color:var(--txt);margin-bottom:6px;}
.mini-chart{width:100%;height:auto;display:block;}
.cohort-wrap{display:flex;flex-direction:column;gap:20px;}
.cohort-block{background:var(--surf);border:1px solid var(--border);border-radius:6px;padding:12px 14px;}
.cohort-block-title{font-size:12.5px;font-weight:700;margin-bottom:8px;}
.cohort-chart{width:100%;height:auto;display:block;max-width:900px;}
.cohort-chart-wide{max-width:none;}
.cohort-table-wrap{overflow-x:auto;margin-top:8px;max-width:900px;border:1px solid var(--border);border-radius:6px;}
.cohort-table-wrap table{font-size:11.5px;}
.pred{font-style:italic;color:var(--muted);}
.tabnote{font-size:11px;color:var(--muted);margin-bottom:14px;line-height:1.5;}
.cohort-block-title-red{color:var(--bad);}
.metric-filter{display:flex;gap:6px;margin-bottom:8px;}
.cm-filter-btn.active{background:var(--accent);color:#04101f;border-color:var(--accent);font-weight:700;}
.cm-view{width:100%;}
</style>

<div class="hdr">
  <div class="hdr-title">📊 국가/OS/매체/캠페인/일자별 성과 — Idol Farm Life</div>
  <div class="hdr-sub" id="hdrSub">${RANGE} KST · 각 레벨 합계, Cost 내림차순 · 설치일(코호트) 기준 · 매일 오전 11시 갱신</div>
</div>
<div class="tabbar">
  <button class="tabbtn active" id="tabbtn-summary" onclick="showTab('summary')">Summary</button>
  <button class="tabbtn" id="tabbtn-table" onclick="showTab('table')">Data Table</button>
  <button class="tabbtn" id="tabbtn-creative" onclick="showTab('creative')">Data Table (소재·주차)</button>
  <button class="tabbtn" id="tabbtn-cohort" onclick="showTab('cohort')">Cohort Trend</button>
</div>
<div class="main">
  <div id="tab-summary" class="tabpanel active">
    <div class="note">
      <div class="note-head">Remark</div>
      <p>국가별 설치일 추이입니다(기본: Cost 상위 ${TOPN}개국).</p>
      <p>단위가 다른 지표를 함께 보기 위해 각 지표를 자체 최댓값 기준 0~100%로 정규화했으며, 막대와 선은 서로 겹치지 않도록 위/아래 별도 구간에 그려집니다.</p>
      <p>실제 값은 막대/선 위에 표시되며, 마우스를 올리면 더 자세히 확인할 수 있습니다.</p>
    </div>
    <div class="bar">
      <div class="barsec">
        <span class="barsec-label">필터</span>
        <div class="dd" id="sumDateDD">
          <button class="btn ddbtn" onclick="toggleSumDD(event)">설치일 필터 <span id="sumddcount"></span> ▾</button>
          <div class="ddpanel" id="sumddpanel"></div>
        </div>
        <div class="dd" id="sumCountryDD">
          <button class="btn ddbtn" onclick="toggleSumCountryDD(event)">국가 필터 <span id="sumccount"></span> ▾</button>
          <div class="ddpanel" id="sumcddpanel"></div>
        </div>
      </div>
    </div>
    <div class="chart-legend">
      <span class="lg"><span class="sw" style="background:var(--c-install)"></span>Install Total</span>
      <span class="lg"><span class="ln" style="background:var(--c-cpi)"></span>Total CPI</span>
      <span class="lg"><span class="sw" style="background:var(--c-iaa)"></span>D1 Rev — IAA</span>
      <span class="lg"><span class="sw" style="background:var(--c-iap)"></span>D1 Rev — IAP</span>
      <span class="lg"><span class="ln" style="background:var(--c-roas)"></span>D1 ROAS</span>
    </div>
    <div class="summary-list" id="summaryList"></div>
  </div>
  <div id="tab-table" class="tabpanel">
    <div class="note">
      <div class="note-head">Remark</div>
      <p>설치일(Date) 레벨은 오름차순으로 정렬됩니다.</p>
      <p>AppsFlyer raw 데이터로 생성된 리포트 대시보드입니다.</p>
      <p>설치일 및 국가는 필터링 가능하며, 매출 지표(절대값)은 숨기기/펼치기 할 수 있습니다.</p>
      <p><b>SKAN Install</b>: Apple에서 전달한 paid 매체의 기여 데이터입니다. 따라서 skan install과 regular install이 구분되어있고, 중복은 제거되었습니다. skan의 기여 데이터는 캠페인 레벨에서 확인가능하므로, GEO 세그먼트를 가장 상위로 배치할 경우 WW(SKAN)으로 귀속됩니다.</p>
      <p><b>RR(%)</b>: 코호트 설치자 중 정확히 해당일(Day-N)에 재방문(세션 발생)한 유저 비율입니다. 매출과 무관하게 재방문 자체만 측정합니다. 코호트가 아직 그 일수만큼 지나지 않았다면 0으로 표시됩니다(예: 설치 후 21일 미만 경과 시 D30 RR은 0).</p>
      <p><b>DAU / Active REV</b>: 코호트 아닌, 캘린더 날짜(이벤트 발생일) 기준입니다. '설치일' 레벨이 확정된 node에는 날짜의 실측값이 표시되지만, 국가·캠페인 등 여러 날짜를 아우르는 세그먼트 행에서는 각 날짜의 값을 단순 합산합니다(재방문 유저가 날짜 수만큼 중복 카운트될 수 있음). 단, 맨 위 '전체 합계' 행의 DAU만은 예외로, 하위 세그먼트 값을 단순 합산하지 않고 선택된 기간·국가 범위에서 실제 재방문을 제거(dedup)한 순수 유저 수를 별도로 계산합니다. 따라서 전체 합계 DAU는 세그먼트별 DAU를 모두 더한 값보다 작습니다. Active REV는 재방문 중복 문제가 없어(금액은 이중 계산되지 않음) 전체 합계도 세그먼트와 동일하게 단순 합산합니다.</p>
    </div>
    <div class="segwrap">
      <div class="segbar" id="segbar"></div>
      <span class="seglabel">세그먼트 계층 (드래그하거나 ◀▶로 순서 변경)</span>
    </div>
    <div class="bar">
      <div class="barsec">
        <span class="barsec-label">필터</span>
        <div class="dd" id="dateDD">
          <button class="btn ddbtn" onclick="toggleDD(event)">설치일 필터 <span id="ddcount"></span> ▾</button>
          <div class="ddpanel" id="ddpanel"></div>
        </div>
        <div class="dd" id="countryDD">
          <button class="btn ddbtn" onclick="toggleCountryDD(event)">국가 필터 <span id="ccount"></span> ▾</button>
          <div class="ddpanel" id="cddpanel"></div>
        </div>
      </div>
      <div class="bar-divider"></div>
      <div class="barsec">
        <span class="barsec-label">보기</span>
        <button class="btn" id="revGroupBtn" onclick="toggleGroup('rev')"></button>
        <button class="btn" id="rrGroupBtn" onclick="toggleGroup('rr')"></button>
        <button class="btn" onclick="expandAll()">모두 펼치기</button>
        <button class="btn" onclick="collapseAll()">모두 접기</button>
      </div>
    </div>
    <div class="tw"><table id="tbl"></table></div>
  </div>
  <div id="tab-creative" class="tabpanel">
    <div class="note">
      <div class="note-head">Remark</div>
      <p>캠페인 하위에 <b>소재(creative)</b>까지 분해한 뷰입니다. 조합 수가 많아지는 것을 감안해, 설치일 대신 캠페인 시작일(2026-07-07)부터 7일 단위로 묶은 <b>주차</b> 기준으로 집계합니다(Day-N 코호트 판정은 실제 설치일 기준으로 계산한 뒤 주차 버킷에 합산 — 정확도 손실 없음).</p>
      <p>DAU/Active REV는 이 뷰에서는 제공하지 않습니다(다른 탭과 동일한 계산을 소재 단위까지 늘리면 데이터량이 지나치게 커짐).</p>
      <p>그 외 지표 정의는 Data Table 탭과 동일합니다. 마지막 주차는 아직 7일이 다 지나지 않은 진행 중 구간일 수 있습니다.</p>
      <p><b>소재카테고리</b>: 소재명에 포함된 core/char/fake/etc/help 태그로 자동 분류한 그룹입니다(이전 명칭 "소재유형"에서 정정).</p>
      <p><b>소재유형</b>: 소재 형식입니다 — vid(동영상) / img(이미지) / video_playable(동영상+플레이어블) / playable(플레이어블 단독). Google은 소재가 아니라 adgroup 단위로 데이터가 들어와 형식을 알 수 없으므로 (미상)으로 표시합니다.</p>
      <p><b>소재명 표기</b>: 풀네임 대신 <code>소재언어_소재넘버링_소재카테고리_소재이름_소재유형</code>만 표시합니다(앱이름·매체명·제작주체·초수 생략). 매체명을 떼기 때문에 같은 소재를 여러 매체에 집행한 경우 소재 축에서는 한 줄로 합쳐집니다 — 매체는 별도 세그먼트로 나눠 보시면 됩니다. Google(adgroup명)과 Applovin은 매체 구조상 규칙을 따르지 않아 각각 원본 그대로 / <code>en_all_<i>카테고리</i>_유형</code> 형태로 표기합니다. 규칙에 맞지 않는 이름은 가공하지 않고 원본을 그대로 둡니다.</p>
      <p><b>(SKAN)</b>: iOS SKAdNetwork 설치입니다. 애플이 소재 단위 식별자를 주지 않아 소재명이 빈 채로 들어오므로 개별 소재로 나눌 수 없습니다(비용·노출도 소재 단위로 매칭되지 않아 0). 매체가 소재명을 넘기지 않은 <b>(no creative)</b>와는 구분해 표시합니다. 소재별 설치 합계를 볼 때 이만큼은 소재 미상으로 빠져 있다는 점을 감안해 주세요.</p>
      <p><b>세그먼트 선택</b>: 9개 세그먼트를 전부 뎁스로 쓰면 트리가 깊어지므로, "세그먼트 선택"에서 필요한 것만 켜서 볼 수 있습니다(칩의 ✕로도 제외 가능). 기본 순서는 매체›캠페인명›소재카테고리›소재유형›소재›주차›국가›paid/org›OS입니다.</p>
      <p><b>IPM</b> = 설치 수 / 노출 수 × 1,000 (1,000회 노출당 설치 수). 노출은 cost_etl_geo 기준이라 소재처럼 잘게 쪼갠 단위에서는 정확도가 떨어질 수 있어 소재 간 <b>상대 비교</b>용으로 보시는 걸 권합니다.</p>
    </div>
    <div class="segwrap">
      <div class="segbar" id="segbar2"></div>
      <span class="seglabel">세그먼트 계층 (드래그하거나 ◀▶로 순서 변경, ✕로 제외)</span>
    </div>
    <div class="bar">
      <div class="barsec">
        <span class="barsec-label">세그먼트</span>
        <div class="dd" id="segDD2">
          <button class="btn ddbtn" onclick="toggleSegDD2(event)">세그먼트 선택 <span id="segcount2"></span> ▾</button>
          <div class="ddpanel" id="segpanel2"></div>
        </div>
      </div>
      <div class="bar-divider"></div>
      <div class="barsec">
        <span class="barsec-label">필터</span>
        <div class="dd" id="weekDD2">
          <button class="btn ddbtn" onclick="toggleWeekDD2(event)">주차 필터 <span id="wdcount2"></span> ▾</button>
          <div class="ddpanel" id="wdpanel2"></div>
        </div>
        <div class="dd" id="countryDD2">
          <button class="btn ddbtn" onclick="toggleCountryDD2(event)">국가 필터 <span id="ccount2"></span> ▾</button>
          <div class="ddpanel" id="cddpanel2"></div>
        </div>
      </div>
      <div class="bar-divider"></div>
      <div class="barsec">
        <span class="barsec-label">보기</span>
        <button class="btn" id="revGroupBtn2" onclick="toggleGroup2('rev')"></button>
        <button class="btn" id="rrGroupBtn2" onclick="toggleGroup2('rr')"></button>
        <button class="btn" onclick="expandAll2()">모두 펼치기</button>
        <button class="btn" onclick="collapseAll2()">모두 접기</button>
      </div>
    </div>
    <div id="topSpenders2"></div>
    <div class="tw"><table id="tbl2"></table></div>
  </div>
  <div id="tab-cohort" class="tabpanel">
    ${COHORT_RANGE_NOTE}
    <div class="note">
      <div class="note-head">Remark</div>
      <p>설치일(코호트) 기준 D1/D3/D7 ROAS 추이입니다.</p>
      <p>코호트 기간이 도래하지 않은 데이터는 제외하였습니다.</p>
      <p>Cost 상위 ${TOPN}개국이 국가별로 이어지며, 각 국가마다 좌: iOS · 우: Android 차트가 표시됩니다.</p>
    </div>
    <div class="cohort-wrap">
      <div class="cohort-block">
        <div class="cohort-block-title cohort-block-title-red">국가별 · OS별 ROAS 및 ROAS 증분율(%)</div>
        <div class="country-charts cohort-2col">
          <div class="chart-panel-title-lg">국가별 실제 ROAS(%)</div>
          <div class="chart-panel-title-lg">국가별 D1 대비 증분율(%)</div>
          <div class="tabnote">D1~D30 누적 ROAS를 국가별로 확인할 수 있습니다.<br>실선은 실측치이며, 점선(옅은 원·기울임체 *)은 예측치입니다. 아직 도래하지 않은 시점의 코호트는 기 도래한 일별 코호트 데이터를 바탕으로 예측하였으며, 코호트가 실제로 도래하면, 예측치는 실측치(실선)로 자동 대체됩니다.</div>
          <div class="tabnote">D1~D30 누적 ROAS를 0% 기준선으로 두고, D3·D7·D14·D21·D30 시점 누적 ROAS가 그보다 몇 % 증가했는지를 나타냅니다.<br>기울기가 가파른 국가일수록 코호트가 오래될수록 ROAS가 계속 늘어난다는 뜻으로, 캠페인을 지속할 근거가 됩니다.<br>실선은 실측치이며, 점선(옅은 원·기울임체 *)은 예측치입니다. 아직 도래하지 않은 시점의 코호트는 기 도래한 일별 코호트 데이터를 바탕으로 예측하였으며, 코호트가 실제로 도래하면, 예측치는 실측치(실선)로 자동 대체됩니다.</div>
          ${cohortFilterBar("abs")}
          ${cohortFilterBar("growth")}
          <div>${cohortViewPanels("abs",COHORT_ABS_SVG)}</div>
          <div>${cohortViewPanels("growth",COHORT_GROWTH_SVG)}</div>
        </div>
        ${COHORT_MERGED_TABLE}
      </div>
      <div class="cohort-block">
        <div class="cohort-block-title">전체 ROAS(IAA+IAP) 추이</div>
        ${D1D3D7_LEGEND}
        <div class="tabnote">실선은 실측치이며, <b>점선(옅은 원·기울임체 *)은 예측치</b>입니다 — 아직 도래하지 않은 코호트(주로 최근 설치일의 D7 이후 구간)는 해당 설치일의 실측 D1 ROAS에 OS 풀링 로그 성장 곡선(iOS+Android 합산)으로 추정한 증분율을 얹어 계산합니다. 코호트가 실제로 쌓이면 예측치는 실측치로 자동 대체됩니다.</div>
        ${ROAS_LINE_CHART}
      </div>
      <div class="cohort-block">
        <div class="cohort-block-title">국가별 · OS별 ROAS 추이</div>
        ${D1D3D7_LEGEND}
        <div class="tabnote">실선은 실측치이며, <b>점선(옅은 원·기울임체 *)은 예측치</b>입니다 — 아직 도래하지 않은 코호트는 해당 설치일의 실측 D1 ROAS에 그 OS 단위 로그 성장 곡선으로 추정한 증분율을 얹어 계산합니다. 코호트가 실제로 쌓이면 예측치는 실측치로 자동 대체됩니다.</div>
        <div class="summary-list">${COUNTRY_OS_SECTIONS}</div>
      </div>
    </div>
  </div>
</div>

<script>
// Cohort Trend 탭 — 절대 ROAS(%)/증분율(%) 차트의 플랫폼(iOS/Android/통합) 필터.
// 두 차트는 각각 독립된 필터를 가지므로 scope("abs"|"growth")로 서로 다른 뷰 셋을 다룬다.
function cohortMetricFilter(scope,osKey){
  ["iOS","Android","ALL"].forEach(function(k){
    var el=document.getElementById("cm-"+scope+"-"+k);
    if(el)el.style.display=(k===osKey)?"":"none";
    var btn=document.getElementById("cm-"+scope+"-btn-"+k);
    if(btn)btn.classList.toggle("active",k===osKey);
  });
}
// Cohort Trend 탭 — 국가별 실측/증분율 표의 OS(통합/iOS/Android) 가로 탭 전환.
function cohortTableTab(osKey){
  ["ALL","iOS","Android"].forEach(function(k){
    var body=document.getElementById("ctt-"+k);
    if(body)body.style.display=(k===osKey)?"":"none";
    var btn=document.getElementById("ctt-btn-"+k);
    if(btn)btn.classList.toggle("active",k===osKey);
  });
}
const RAW_ALL = ${JSON.stringify(ROWS)};
const TOP_COUNTRIES = ${JSON.stringify(TOP_COUNTRIES)}; // Summary 탭 기본 선택 국가(Cost 상위)
// 모든 국가 포함(사용자 요청) — 과거에는 "cost>0 또는 SKAN설치>0인 국가만 유지"하는 임계값
// 필터가 있어 유료 지출·SKAN 활동이 한 번도 없었던 국가(유기적 설치 등)가 통째로 숨겨졌음.
// 이제 실제 국가코드는 지출 유무와 무관하게 전부 표시하고, 국가정보 자체가 없는 행(??/N/A/공백)만 제외.
const UNKNOWN=["??","N/A",""];
const RAW = RAW_ALL.filter(r=>!UNKNOWN.includes(r.country));
// paid/org: 매체(media)의 상위 카테고리 — organic이 아닌 매체는 전부 'paid'로 묶어
// 유료 매체 전체 성과를 한눈에 파악할 수 있게 한다.
for(const r of RAW) r.paid_org = r.media==="organic" ? "organic" : "paid";
// DAU/Active REV(캘린더 날짜 기준) — RAW와 동일한 5개 차원(country/paid_org/media/campaign/os)에
// date만 "설치일 코호트"가 아닌 "이벤트 발생일(캘린더일)"이라는 점이 다르다.
const DAILY_ACTIVE_ALL = ${JSON.stringify(DAILY_ACTIVE)};
for(const r of DAILY_ACTIVE_ALL) r.paid_org = r.media==="organic" ? "organic" : "paid";
const DAILY_ACTIVE_RAW = DAILY_ACTIVE_ALL.filter(r=>!UNKNOWN.includes(r.country));
// 소재(creative)·주차별 뎁스 데이터셋 — RAW와 완전히 별개(Data Table(소재) 탭 전용).
const RAW2_ALL = ${JSON.stringify(ROWS_CREATIVE)};
const RAW2 = RAW2_ALL.filter(r=>!UNKNOWN.includes(r.country));
for(const r of RAW2) r.paid_org = r.media==="organic" ? "organic" : "paid";
// 소재 규격(사이즈) 병합 — 이제는 수집 단계(geo-cohort-os.mjs의 creativeLabel)에서 이미
// 처리되므로 여기 남은 것은 멱등한 안전망이다(규격 토큰이 남아있는 예전 result JSON을 그대로
// 열어봐도 화면에서는 병합되도록). 트리/Top Spender는 소재명으로 groupby해 합산하므로,
// 이름만 통일하면 나머지 합산은 자동으로 처리된다.
function stripCreativeSize(name){
  return String(name).replace(/_\\d{2,5}x\\d{2,5}(\\.\\w+)?(?=_|$)/gi,"");
}
for(const r of RAW2) r.creative=stripCreativeSize(r.creative);
// 소재명 정리(사용자 요청, Applovin 전용): "if_video_playable"/"video_playable"(if_ 유무 두 표기
// 모두 존재)은 이름만으로는 유형을 알 수 없어 core임을 명시해 하나로 합치고, Applovin 소재명
// 전체에서 "if_" 접두사는 제거한다(사용자 요청).
for(const r of RAW2){
  if(r.media!=="applovin_int")continue;
  if(r.creative==="if_video_playable"||r.creative==="video_playable") r.creative="video_playable(core)";
  else if(r.creative.startsWith("if_")) r.creative=r.creative.slice(3);
}
// ══ 소재명 규칙 ══════════════════════════════════════════════════════════════
// 명명 규칙: 앱이름_소재언어_매체명_소재넘버링_소재카테고리_소재이름_소재유형_소재제작주체_(초수)
//   예) if_en_moloco_26007_fake_harvest(watermelon)_vid_ab_30s
// 화면에는 "소재언어_소재넘버링_소재카테고리_소재이름_소재유형"만 보인다(사용자 요청) —
// 앱이름·매체명·제작주체·초수는 뗀다. 매체명을 떼면 같은 소재가 매체만 다른 경우 한 줄로
// 합쳐지는데, 매체는 이미 별도 세그먼트이므로 소재 축에서는 합치는 게 맞다.
//
// 토큰 위치가 고정이 아니다(예: "if_en_test_meta_core_..."는 넘버링이 아예 없음). 그래서
// 인덱스가 아니라 앵커(유형 토큰/넘버링/카테고리 태그)를 찾아 자른다. 셋 중 하나라도 못
// 찾으면 가공하지 않고 원본을 그대로 둔다.
const CCAT_TAGS=["core","char","fake","etc","help"];
// 주의: 이 블록은 바깥 템플릿 리터럴 안에 들어가므로 정규식 백슬래시는 반드시 \\로 써야 한다
// (\d 로 쓰면 출력 HTML에서 d 로 바뀌어 정규식이 깨진다).
const isPlaceholderCre=(c)=>/^\\(|^\\{/.test(String(c));    // (organic) / (no creative) / {AD_NAME}
const hasLangPrefix=(c)=>/^(?:[a-z0-9]+_)?(en|ja|kr|ko)_/i.test(String(c));
// 소재명을 토큰으로 쪼개고 공백 오타("char_ ai+story1")를 흡수한다.
const creTokens=(c)=>String(c).split("_").map(s=>s.trim()).filter(Boolean);
// 소재유형 토큰의 위치와 값. video+playable 쌍 > playable > vid > img 순으로 첫 매치.
function findFormat(t){
  for(let i=0;i<t.length;i++){
    const a=t[i].toLowerCase();
    if(a==="video"&&t[i+1]&&t[i+1].toLowerCase().startsWith("playable"))return{i,fmt:"video_playable"};
    if(a.startsWith("playable"))return{i,fmt:"playable"};
    if(a==="vid")return{i,fmt:"vid"};
    if(a==="img")return{i,fmt:"img"};
  }
  return null;
}
// 소재유형(vid/img/video_playable/playable) — 세그먼트 값.
// Google은 소재가 아니라 adgroup명이 들어오고(한 adgroup에 여러 형식이 섞일 수 있음) 형식을
// 알 수 없어 (미상)으로 둔다. "전부 동영상"으로 보려면 아래 google 분기를 "vid"로 바꾸면 된다.
function creativeFormat(cre,media){
  if(isPlaceholderCre(cre))return "(미상)";
  if(media==="googleadwords_int")return "(미상)";
  const f=findFormat(creTokens(cre));
  if(f)return f.fmt;
  // 언어구분자가 없는 Applovin 소재는 전부 동영상(사용자 확인).
  if(media==="applovin_int"&&!hasLangPrefix(cre))return "vid";
  return "(미상)";
}
// 규칙을 따르는 소재명을 "언어_넘버링_카테고리_소재이름_유형"으로 줄인다.
function shortenStd(cre){
  const t=creTokens(cre);
  const f=findFormat(t); if(!f)return null;
  const ni=t.findIndex(p=>/^[0-9]{4,6}$/.test(p)); if(ni<0)return null;
  // 카테고리는 넘버링 바로 다음 토큰이 우선. 테마명에 태그 문자열이 섞인 경우(예: core_
  // "fakeupgrade")를 잘못 잡지 않기 위해서다. 없으면 태그 전체 검색으로 폴백.
  let ci=(t[ni+1]&&CCAT_TAGS.includes(t[ni+1].toLowerCase()))?ni+1:t.findIndex(p=>CCAT_TAGS.includes(p.toLowerCase()));
  if(ci<0)return null;
  const lang=/^(en|ja|kr|ko)$/i.test(t[1]||"")?t[1].toLowerCase():null;
  const tail=f.fmt==="video_playable"?["video","playable"]:[t[f.i]];
  return [lang,t[ni],t[ci].toLowerCase(),...t.slice(ci+1,f.i),...tail].filter(Boolean).join("_");
}
// 매체별 예외(사용자 확인): Google·Applovin은 매체 구조상 소재 단위 데이터가 규칙을 따르지 않는다.
//  · Google  — 값이 adgroup명이라 가공하지 않고 원본 그대로 노출한다.
//  · Applovin — 언어구분자가 없으면 언어=en, 넘버링=all로 채우고 카테고리 자리에 기존 이름을 쓴다.
//               "video_playable(core)"처럼 괄호가 있으면 그 안의 값을 카테고리로 쓴다.
function shortCreative(cre,media){
  if(isPlaceholderCre(cre))return cre;                      // 플레이스홀더는 손대지 않음
  if(media==="googleadwords_int")return cre;
  if(media==="applovin_int"&&!hasLangPrefix(cre)){
    const m=String(cre).match(/^video_playable\\((\\w+)\\)$/i);
    if(m)return \`en_all_\${m[1].toLowerCase()}_video_playable\`;
    return \`en_all_\${cre}_vid\`;
  }
  return shortenStd(cre)||cre;
}
// 소재카테고리(core/char/fake/etc/help) — 예전에 "소재유형"이라 부르던 값(사용자 정정).
// 단축된 이름 기준으로 판정한다: "en_26007_fake_harvest(watermelon)_vid"처럼 넘버링이 남아
// 있으면 그 다음 토큰을, "en_all_char1_vid"/"core"처럼 없으면 문자열 포함 여부로 폴백한다.
function creativeCat(cre){
  if(isPlaceholderCre(cre))return cre;
  const parts=String(cre).split("_");
  const si=parts.findIndex(p=>/^[0-9]{4,6}$/.test(p));
  if(si>=0 && parts[si+1]){
    const t=parts[si+1].toLowerCase();
    if(CCAT_TAGS.includes(t))return t;
  }
  const low=String(cre).toLowerCase();
  for(const t of CCAT_TAGS)if(low.includes(t))return t;
  return "기타";
}
// 소재유형은 단축 전 이름으로 판정하고(원본 토큰이 온전할 때가 정확), 그 다음 이름을 줄인 뒤
// 카테고리를 뽑는다.
for(const r of RAW2){
  // SKAN 설치 표시(사용자 요청): SKAN은 애플이 소재 단위 식별자를 주지 않아 소재명이 빈 채로
  // 들어온다. 데이터로 확인한 결과 소재명이 비어있으면서 install_skan>0인 행은 전부 iOS이고
  // SKAN 100%(일반 설치와 섞인 행 0건)라, 매체가 소재명을 안 넘긴 경우와 명확히 구분된다.
  // 이걸 "(no creative)"로 뭉뚱그리면 누락처럼 보이므로 "(SKAN)"으로 따로 표시한다.
  if(r.creative==="(no creative)" && (r.install_skan||0)>0) r.creative="(SKAN)";
  r.creative_format = creativeFormat(r.creative,r.media);
  r.creative = shortCreative(r.creative,r.media);
  r.creative_cat = creativeCat(r.creative);
}
const CCAT_COLOR={core:"var(--google)",char:"var(--applovin)",fake:"var(--facebook)",etc:"var(--muted)",help:"var(--liftoff)","(organic)":"var(--organic)","(no creative)":"var(--dim)","(SKAN)":"var(--muted)","기타":"var(--dim)"};
const CFMT_COLOR={vid:"var(--facebook)",img:"var(--google)",video_playable:"var(--applovin)",playable:"var(--liftoff)","(미상)":"var(--dim)"};
// "전체 합계" DAU 전용: 국가별·날짜별 dedup 유저 ID(정수). 세그먼트 트리 노드의 DAU(위 DAILY_ACTIVE_RAW
// 기반, 여러 날짜 단순 합산)와는 별개로, 전체 합계 행만 이 데이터로 "기간 내 실제 순수 유저 수"를 계산한다.
const DAU_USERS = ${JSON.stringify(DAU_USERS)};
const MLABEL={"googleadwords_int":"Google","Facebook Ads":"Facebook","applovin_int":"Applovin","liftoff_int":"Liftoff","organic":"Organic"};
const MCOLOR={"googleadwords_int":"var(--google)","Facebook Ads":"var(--facebook)","applovin_int":"var(--applovin)","liftoff_int":"var(--liftoff)","organic":"var(--organic)"};
const DIM_META={paid_org:{label:"paid/org"},country:{label:"국가"},os:{label:"OS"},media:{label:"매체"},campaign:{label:"캠페인명"},date:{label:"설치일"}};
let LEVELS=["country","paid_org","media","date","campaign","os"]; // 사용자가 세그먼트 칩을 드래그/◀▶로 재정렬하면 이 배열이 바뀜(기본값: 국가-paid/org-매체-설치일-캠페인명-os)
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
const METRICS=[
  {k:"cost",label:"Cost",type:"$"},
  {k:"install_total",label:"Install<br>Total",type:"n",hg:"blue-dark"},
  {k:"install_reg",label:"Regular<br>Install",type:"n",hg:"blue"},
  {k:"install_skan",label:"SKAN<br>Install",type:"n",hg:"blue"},
  {k:"cpi",label:"CPI<br>(Total)",type:"$",hg:"blue-dark"},
  {k:"cpi_reg",label:"CPI<br>(Regular)",type:"$",hg:"blue"},
  // DAU/Active REV: 설치일(코호트)이 아닌 캘린더 날짜(이벤트 발생일) 기준 지표. 아래 Remark 참고.
  {k:"dau",label:"DAU",type:"n",hg:"purple"},
  {k:"active_rev",label:"Active REV",type:"$",hg:"purple"},
  // ctrlGrp: 이 헤더의 캐럿(▶)을 클릭하면 grp가 같은 하위 지표들이 펼쳐짐/접힘(기본 접힘 — collapsedGroups 초기값 참조).
  {k:"roas_d1",label:"D1 ROAS<br>(IAA+IAP)",type:"%",hg:"pink",ctrlGrp:"d1"},
  {k:"roas_d1_iaa",label:"D1 IAA<br>ROAS",type:"%",grp:"d1"},
  {k:"roas_d1_iap",label:"D1 IAP<br>ROAS",type:"%",grp:"d1"},
  {k:"pur_d1",label:"D1 PUR<br>(%)",type:"%",grp:"d1"},
  {k:"roas_d3",label:"D3 ROAS<br>(IAA+IAP)",type:"%",hg:"pink",ctrlGrp:"d3"},
  {k:"roas_d3_iaa",label:"D3 IAA<br>ROAS",type:"%",grp:"d3"},
  {k:"roas_d3_iap",label:"D3 IAP<br>ROAS",type:"%",grp:"d3"},
  {k:"pur_d3",label:"D3 PUR<br>(%)",type:"%",grp:"d3"},
  {k:"roas_d7",label:"D7 ROAS<br>(IAA+IAP)",type:"%",hg:"pink",ctrlGrp:"d7"},
  {k:"roas_d7_iaa",label:"D7 IAA<br>ROAS",type:"%",grp:"d7"},
  {k:"roas_d7_iap",label:"D7 IAP<br>ROAS",type:"%",grp:"d7"},
  {k:"roas_d14",label:"D14 ROAS<br>(IAA+IAP)",type:"%",hg:"pink",ctrlGrp:"d14"},
  {k:"roas_d14_iaa",label:"D14 IAA<br>ROAS",type:"%",grp:"d14"},
  {k:"roas_d14_iap",label:"D14 IAP<br>ROAS",type:"%",grp:"d14"},
  {k:"roas_d21",label:"D21 ROAS<br>(IAA+IAP)",type:"%",hg:"pink",ctrlGrp:"d21"},
  {k:"roas_d21_iaa",label:"D21 IAA<br>ROAS",type:"%",grp:"d21"},
  {k:"roas_d21_iap",label:"D21 IAP<br>ROAS",type:"%",grp:"d21"},
  {k:"roas_d30",label:"D30 ROAS<br>(IAA+IAP)",type:"%",hg:"pink",ctrlGrp:"d30"},
  {k:"roas_d30_iaa",label:"D30 IAA<br>ROAS",type:"%",grp:"d30"},
  {k:"roas_d30_iap",label:"D30 IAP<br>ROAS",type:"%",grp:"d30"},
  // grp:"rev" — 접기 가능한 매출(절대값) 지표 그룹. D1 Rev(IAA+IAP) ~ SKAN Rev(coarse)까지.
  // 앞으로 매출 관련 절대값 지표(예: D14 Rev 등)를 추가할 때도 grp:"rev"만 붙이면 자동으로
  // 접기 그룹에 포함된다(별도 목록을 따로 유지할 필요 없음 — toggleGroup()이 이 태그만 본다).
  {k:"rev_d1",label:"D1 Rev<br>(IAA+IAP)",type:"$",grp:"rev"},
  {k:"rev_d1_iap",label:"D1<br>IAP",type:"$",grp:"rev"},
  {k:"rev_d1_iaa",label:"D1<br>IAA",type:"$",grp:"rev"},
  {k:"rev_d3",label:"D3 Rev<br>(IAA+IAP)",type:"$",grp:"rev"},
  {k:"rev_d3_iap",label:"D3<br>IAP",type:"$",grp:"rev"},
  {k:"rev_d3_iaa",label:"D3<br>IAA",type:"$",grp:"rev"},
  {k:"rev_d7",label:"D7 Rev<br>(IAA+IAP)",type:"$",grp:"rev"},
  {k:"rev_d7_iap",label:"D7<br>IAP",type:"$",grp:"rev"},
  {k:"rev_d7_iaa",label:"D7<br>IAA",type:"$",grp:"rev"},
  {k:"rev_d14",label:"D14 Rev<br>(IAA+IAP)",type:"$",grp:"rev"},
  {k:"rev_d14_iap",label:"D14<br>IAP",type:"$",grp:"rev"},
  {k:"rev_d14_iaa",label:"D14<br>IAA",type:"$",grp:"rev"},
  {k:"rev_d21",label:"D21 Rev<br>(IAA+IAP)",type:"$",grp:"rev"},
  {k:"rev_d21_iap",label:"D21<br>IAP",type:"$",grp:"rev"},
  {k:"rev_d21_iaa",label:"D21<br>IAA",type:"$",grp:"rev"},
  {k:"rev_d30",label:"D30 Rev<br>(IAA+IAP)",type:"$",grp:"rev"},
  {k:"rev_d30_iap",label:"D30<br>IAP",type:"$",grp:"rev"},
  {k:"rev_d30_iaa",label:"D30<br>IAA",type:"$",grp:"rev"},
  {k:"skan_rev",label:"SKAN Rev<br>(coarse)",type:"$",grp:"rev"},
  // grp:"rr" — 접기 가능한 리텐션(%) 지표 그룹. RR(%) = 코호트 설치자 중 정확히 해당일(Day-N)에
  // 재방문(af_session)한 유저 비율. 매출과 무관한 순수 재방문율이므로 rev 그룹과는 별개로 접는다.
  {k:"rr_d1",label:"D1 RR<br>(%)",type:"%",grp:"rr",hg:"green"},
  {k:"rr_d3",label:"D3 RR<br>(%)",type:"%",grp:"rr",hg:"green"},
  {k:"rr_d7",label:"D7 RR<br>(%)",type:"%",grp:"rr",hg:"green"},
  {k:"rr_d30",label:"D30 RR<br>(%)",type:"%",grp:"rr",hg:"green"},
  {k:"imp",label:"Imp",type:"n",hg:"yellow"},
  {k:"cpm",label:"CPM",type:"$",hg:"yellow"},
  {k:"ctr",label:"CTR<br>(%)",type:"%",hg:"yellow"},
  {k:"cpc",label:"CPC",type:"$",hg:"yellow"},
  {k:"cvr",label:"CVR<br>(clk→inst)",type:"%",hg:"yellow"},
];
// ══ Data Table(소재별) 탭 — RAW2(소재+주차) 전용 차원/지표 메타. DAU/Active REV는 이 데이터셋에
// 없으므로(캘린더일 기준 집계를 별도로 만들지 않음) METRICS에서 그 두 항목만 제외한 목록을 쓴다.
const DIM_META2={paid_org:{label:"paid/org"},country:{label:"국가"},os:{label:"OS"},media:{label:"매체"},campaign:{label:"캠페인명"},creative:{label:"소재"},creative_cat:{label:"소재카테고리"},creative_format:{label:"소재유형"},week:{label:"주차"}};
// 기본 세그먼트 순서(사용자 요청): 매체-캠페인명-소재카테고리-소재유형-소재-주차-국가-paid/org-os.
// 소재유형은 카테고리 다음에 둬서 카테고리→형식→개별소재 순으로 좁혀지게 한다.
// LEVELS2는 "순서"만 담고, 실제 트리 뎁스로 쓸지는 ACTIVE2(활성 여부)가 결정한다.
let LEVELS2=["media","campaign","creative_cat","creative_format","creative","week","country","paid_org","os"];
// 활성 세그먼트(사용자 요청): 8개를 전부 뎁스로 쓰면 트리가 너무 깊어져서, 필요한 것만 골라
// 쓸 수 있게 한다. 기본값은 전체 활성(기존 동작과 동일) — "세그먼트 선택" 드롭다운에서 해제한다.
let ACTIVE2=new Set(LEVELS2);
// 현재 트리 뎁스로 쓰이는 세그먼트 목록(순서 유지, 비활성 제외).
function activeLevels2(){return LEVELS2.filter(k=>ACTIVE2.has(k));}
const METRICS2=[
  ...METRICS.filter(m=>m.k!=="dau"&&m.k!=="active_rev"),
  {k:"ipm",label:"IPM<br>(inst/1k imp)",type:"n2",hg:"yellow"},
];
function blank(){return {cost:0,install_total:0,install_reg:0,install_skan:0,imp:0,clk:0,pur_d1_cnt:0,pur_d3_cnt:0,rev_d1:0,rev_d3:0,rev_d7:0,rev_d1_iap:0,rev_d1_iaa:0,rev_d3_iap:0,rev_d3_iaa:0,rev_d7_iap:0,rev_d7_iaa:0,rev_d14:0,rev_d14_iap:0,rev_d14_iaa:0,rev_d21:0,rev_d21_iap:0,rev_d21_iaa:0,rev_d30:0,rev_d30_iap:0,rev_d30_iaa:0,skan_rev:0,rr_d1_users:0,rr_d3_users:0,rr_d7_users:0,rr_d30_users:0};}
function addInto(a,r){a.cost+=r.cost;a.install_total+=r.install_total;a.install_reg+=r.install_reg;a.install_skan+=r.install_skan;a.imp+=(r.imp||0);a.clk+=(r.clk||0);a.pur_d1_cnt+=(r.pur_d1_cnt||0);a.pur_d3_cnt+=(r.pur_d3_cnt||0);a.rev_d1+=r.rev_d1;a.rev_d3+=r.rev_d3;a.rev_d7+=(r.rev_d7||0);a.rev_d1_iap+=r.rev_d1_iap;a.rev_d1_iaa+=r.rev_d1_iaa;a.rev_d3_iap+=r.rev_d3_iap;a.rev_d3_iaa+=r.rev_d3_iaa;a.rev_d7_iap+=(r.rev_d7_iap||0);a.rev_d7_iaa+=(r.rev_d7_iaa||0);a.rev_d14+=(r.rev_d14||0);a.rev_d14_iap+=(r.rev_d14_iap||0);a.rev_d14_iaa+=(r.rev_d14_iaa||0);a.rev_d21+=(r.rev_d21||0);a.rev_d21_iap+=(r.rev_d21_iap||0);a.rev_d21_iaa+=(r.rev_d21_iaa||0);a.rev_d30+=(r.rev_d30||0);a.rev_d30_iap+=(r.rev_d30_iap||0);a.rev_d30_iaa+=(r.rev_d30_iaa||0);a.skan_rev+=(r.skan_rev||0);a.rr_d1_users+=(r.rr_d1_users||0);a.rr_d3_users+=(r.rr_d3_users||0);a.rr_d7_users+=(r.rr_d7_users||0);a.rr_d30_users+=(r.rr_d30_users||0);}
function derive(a){
  a.cpi=a.install_total>0?a.cost/a.install_total:null;
  a.cpi_reg=a.install_reg>0?a.cost/a.install_reg:null;
  const R=(n)=>a.cost>0&&n>0?n/a.cost*100:null;
  a.roas_d1=R(a.rev_d1); a.roas_d1_iaa=R(a.rev_d1_iaa); a.roas_d1_iap=R(a.rev_d1_iap);
  a.roas_d3=R(a.rev_d3); a.roas_d3_iaa=R(a.rev_d3_iaa); a.roas_d3_iap=R(a.rev_d3_iap);
  a.roas_d7=R(a.rev_d7); a.roas_d7_iaa=R(a.rev_d7_iaa); a.roas_d7_iap=R(a.rev_d7_iap);
  a.roas_d14=R(a.rev_d14); a.roas_d14_iaa=R(a.rev_d14_iaa); a.roas_d14_iap=R(a.rev_d14_iap);
  a.roas_d21=R(a.rev_d21); a.roas_d21_iaa=R(a.rev_d21_iaa); a.roas_d21_iap=R(a.rev_d21_iap);
  a.roas_d30=R(a.rev_d30); a.roas_d30_iaa=R(a.rev_d30_iaa); a.roas_d30_iap=R(a.rev_d30_iap);
  // PUR(%) = 유료 결제자 수 / 전체 사용자 수(install_total) × 100 (D1/D3 누적)
  a.pur_d1=a.install_total>0?a.pur_d1_cnt/a.install_total*100:null;
  a.pur_d3=a.install_total>0?a.pur_d3_cnt/a.install_total*100:null;
  // RR(%) = 정확히 해당일(Day-N)에 재방문(af_session)한 유저 수 / 전체 사용자 수(install_total) × 100
  a.rr_d1=a.install_total>0?a.rr_d1_users/a.install_total*100:null;
  a.rr_d3=a.install_total>0?a.rr_d3_users/a.install_total*100:null;
  a.rr_d7=a.install_total>0?a.rr_d7_users/a.install_total*100:null;
  a.rr_d30=a.install_total>0?a.rr_d30_users/a.install_total*100:null;
  // 광고 퍼널 지표 (cost_etl_geo의 imp/clk 기반)
  a.cpm=a.imp>0?a.cost/a.imp*1000:null;   // 1,000 노출당 비용
  a.ctr=a.imp>0?a.clk/a.imp*100:null;      // 클릭률
  a.cpc=a.clk>0?a.cost/a.clk:null;          // 클릭당 비용
  a.cvr=a.clk>0?a.install_total/a.clk*100:null; // 클릭→설치 전환율
  // IPM(Installs Per Mille) = 1,000회 노출당 설치 수(사용자 요청).
  // 주의: 노출(imp)은 cost_etl_geo 기준이라 소재처럼 잘게 쪼갠 단위에서는 정확도가 떨어질 수
  // 있다(대시보드 B의 eCPM 주석과 동일한 한계) — 소재 간 상대 비교용으로 본다.
  a.ipm=a.imp>0?a.install_total/a.imp*1000:null;
  return a;
}

// 설치일 필터 옵션: 데이터에 존재하는 날짜(2026-07-07 ~ 전일)
const DATES_WITH_DATA=new Set(RAW.map(r=>r.date));
const DATE_OPTIONS=[...DATES_WITH_DATA].sort();
const selectedDates=new Set([...DATES_WITH_DATA]); // 기본: 전체 선택

// 국가 필터 옵션: 데이터에 존재하는 국가 전체
const COUNTRY_OPTIONS=[...new Set(RAW.map(r=>r.country))].sort();
const selectedCountries=new Set(COUNTRY_OPTIONS); // 기본: 전체 선택
let countrySearch="";

// 컬럼(지표) 그룹 접기. "rev"(매출 절대값)는 기본 펼침, "d1"/"d3"/"d7"(IAA/IAP 세부·PUR)는 기본 접힘
// — 각 D1/D3/D7 ROAS(IAA+IAP) 헤더의 캐럿(▶)을 클릭해 펼친다.
const collapsedGroups=new Set(["d1","d3","d7","d14","d21","d30","rev"]);
function visibleMetrics(){return METRICS.filter(m=>!(m.grp&&collapsedGroups.has(m.grp)));}
function toggleGroup(g){collapsedGroups.has(g)?collapsedGroups.delete(g):collapsedGroups.add(g);render();}

// DAU/Active REV 인덱스: 트리와 동일한 LEVELS 순서로 DAILY_ACTIVE_RAW를 재귀 분할해 각 노드의
// 부분합을 미리 구해둔다(트리의 "date"는 설치일 코호트, 여기서의 "date"는 캘린더일이지만 같은
// YYYY-MM-DD 문자열 공간이라 값 매칭이 그대로 성립 — date가 아직 고정되지 않은 상위 레벨에서는
// 여러 날짜에 걸쳐 자동으로 합산되고, date가 고정된 노드/자손에서는 그 날짜 하나의 실측값이 된다).
function buildDauIndex(rows,depth){
  if(depth>=LEVELS.length){
    let dau=0,active_rev=0;for(const r of rows){dau+=r.dau;active_rev+=r.active_rev;}
    return {dau,active_rev,kids:null};
  }
  const key=LEVELS[depth];
  const groups={};
  for(const r of rows){(groups[r[key]]=groups[r[key]]||[]).push(r);}
  const kids={};
  let dau=0,active_rev=0;
  for(const [val,rs] of Object.entries(groups)){
    const sub=buildDauIndex(rs,depth+1);
    kids[val]=sub; dau+=sub.dau; active_rev+=sub.active_rev;
  }
  return {dau,active_rev,kids};
}

// 트리 빌드 (레벨별 정렬: 설치일=오름차순, 그 외=Cost 내림차순)
let idc=0;
function build(rows,depth,dauNode){
  if(depth>=LEVELS.length){return null;}
  const key=LEVELS[depth];
  const groups={};
  for(const r of rows){(groups[r[key]]=groups[r[key]]||[]).push(r);}
  const nodes=[];
  for(const [val,rs] of Object.entries(groups)){
    const agg=blank();for(const r of rs)addInto(agg,r);derive(agg);
    const childDau=dauNode&&dauNode.kids?dauNode.kids[val]:null;
    const node={id:++idc,dim:key,value:val,depth,...agg,dau:childDau?childDau.dau:0,active_rev:childDau?childDau.active_rev:0,children:build(rs,depth+1,childDau)};
    nodes.push(node);
  }
  if(key==="date")nodes.sort((a,b)=>String(a.value).localeCompare(String(b.value))); // 오름차순
  else nodes.sort((a,b)=>b.cost-a.cost || b.install_total-a.install_total); // Cost 내림차순, Cost=0(동률)이면 Install Total 내림차순
  return nodes;
}
// "전체 합계" 행 전용 DAU: 선택된 국가별로 선택된 날짜들의 유저 ID Set을 합집합(union)한 뒤 그 크기를
// 더한다 — 국가끼리는 유저가 겹치지 않으므로 국가 간 합산은 안전하지만, 같은 국가 내 여러 날짜는
// 반드시 union으로 처리해야 재방문 유저가 중복 카운트되지 않는다(트리 노드 값의 "단순 합산"과 다름).
function computePeriodDau(){
  let total=0;
  for(const country of selectedCountries){
    const byDate=DAU_USERS[country]; if(!byDate)continue;
    const union=new Set();
    for(const [d,ids] of Object.entries(byDate)){
      if(!selectedDates.has(d))continue;
      for(const id of ids)union.add(id);
    }
    total+=union.size;
  }
  return total;
}
let TREE=[];
let DAU_ROOT=null;
let PERIOD_DAU=0;
function rebuild(){
  idc=0;
  const dauScope=DAILY_ACTIVE_RAW.filter(r=>selectedDates.has(r.date)&&selectedCountries.has(r.country));
  DAU_ROOT=buildDauIndex(dauScope,0);
  PERIOD_DAU=computePeriodDau();
  TREE=build(RAW.filter(r=>selectedDates.has(r.date)&&selectedCountries.has(r.country)),0,DAU_ROOT);
  render();
}
const expanded=new Set();

function fmt(v,t){if(v==null)return '<span class="na">–</span>';if(t==="$")return "$"+(+v).toLocaleString(undefined,{maximumFractionDigits:2});if(t==="%")return (+v).toFixed(1)+"%";if(t==="n")return (+v).toLocaleString();if(t==="n2")return (+v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});return v;}
function countryLabel(v){
  if(v==="WW")return 'WW(SKAN)';
  if(["??","N/A",""].includes(v))return '미상 (국가정보 없음)';
  return esc(v);
}
function dimLabel(node){
  const v=node.value;
  if(node.dim==="paid_org")return \`<span class="po-pill po-\${esc(v)}">\${esc(v)}</span>\`;
  if(node.dim==="media")return \`<span class="dot" style="background:\${MCOLOR[v]||'var(--organic)'}"></span>\${esc(MLABEL[v]||v)}\`;
  if(node.dim==="os")return \`<span class="os-pill os-\${esc(v)}">\${esc(v)}</span>\`;
  if(node.dim==="date")return esc(String(v).slice(5));
  if(node.dim==="campaign")return \`<span class="camp" title="\${esc(v)}">\${esc(v)}</span>\`;
  return countryLabel(v); // country
}
function roasCls(v){return v==null?"":v>=100?"pos":v>=50?"mid":"";}
function renderNodes(nodes,rowsArr,metrics){
  for(const n of nodes){
    const hasKids=n.children&&n.children.length;
    const open=expanded.has(n.id);
    let tds=\`<td class="left node \${hasKids?'':'leaf'} lvl\${n.depth}" style="padding-left:\${10+n.depth*20}px" \${hasKids?\`onclick="toggle(\${n.id})"\`:''}>\`;
    tds+=\`<span class="caret" style="transform:rotate(\${open?90:0}deg)">\${hasKids?'▶':''}</span>\${dimLabel(n)}</td>\`;
    for(const m of metrics){
      const cls=m.k.startsWith("roas")?roasCls(n[m.k]):"";
      tds+=\`<td class="\${cls} lvl\${n.depth}">\${fmt(n[m.k],m.type)}</td>\`;
    }
    rowsArr.push(\`<tr>\${tds}</tr>\`);
    if(hasKids&&open)renderNodes(n.children,rowsArr,metrics);
  }
}
// 버튼별 접기/펼치기 그룹 설정 — 새 그룹 토글 버튼을 추가할 때 이 배열에 한 줄만 추가하면 됨.
const GROUP_BUTTONS=[{id:"revGroupBtn",grp:"rev",label:"매출 지표"},{id:"rrGroupBtn",grp:"rr",label:"RR 지표"}];
function updateGroupBtn(){
  for(const g of GROUP_BUTTONS){
    const count=METRICS.filter(m=>m.grp===g.grp).length;
    const collapsed=collapsedGroups.has(g.grp);
    document.getElementById(g.id).textContent=collapsed?\`\${g.label} 펼치기 (\${count})\`:\`\${g.label} 접기\`;
  }
}
function render(){
  const total=blank();for(const r of RAW)if(selectedDates.has(r.date)&&selectedCountries.has(r.country))addInto(total,r);derive(total);
  total.dau=PERIOD_DAU; total.active_rev=DAU_ROOT?DAU_ROOT.active_rev:0;
  const vis=visibleMetrics();
  let h='<thead><tr><th class="left">구분</th>'+vis.map(m=>{
    const cls=m.hg?'th-'+m.hg:'';
    if(m.ctrlGrp){
      const open=!collapsedGroups.has(m.ctrlGrp);
      return \`<th class="\${cls} th-toggle-parent" onclick="toggleGroup('\${m.ctrlGrp}')"><span class="th-caret" style="transform:rotate(\${open?90:0}deg)">▶</span>\${m.label}</th>\`;
    }
    return \`<th class="\${cls}">\${m.label}</th>\`;
  }).join("")+'</tr></thead><tbody>';
  h+='<tr class="grand-total"><td class="left">전체 합계</td>';
  for(const m of vis)h+=\`<td>\${fmt(total[m.k],m.type)}</td>\`;
  h+='</tr>';
  const arr=[];renderNodes(TREE,arr,vis);h+=arr.join("");
  h+='</tbody>';
  updateGroupBtn();
  const tbl=document.getElementById("tbl");
  tbl.innerHTML=h;
  // 전체 합계 행을 헤더 바로 아래에 고정(sticky) — 헤더 높이가 라벨 줄바꿈에 따라 달라지므로 실측해 반영
  const headTr=tbl.querySelector("thead tr");
  if(headTr) tbl.style.setProperty("--head-h", headTr.getBoundingClientRect().height+"px");
}
function toggle(id){expanded.has(id)?expanded.delete(id):expanded.add(id);render();}
function allIds(nodes,acc){for(const n of nodes){if(n.children&&n.children.length){acc.push(n.id);allIds(n.children,acc);}}return acc;}
function expandAll(){allIds(TREE,[]).forEach(id=>expanded.add(id));render();}
function collapseAll(){expanded.clear();render();}

// 설치일 드롭다운 체크박스
function renderChips(){
  document.getElementById("ddcount").textContent="("+selectedDates.size+")";
  const items=DATE_OPTIONS.map(d=>{
    const on=selectedDates.has(d), nodata=!DATES_WITH_DATA.has(d);
    return \`<label class="ddi \${nodata?'nodata':''}" title="\${nodata?'데이터 없음':''}"><input type="checkbox" \${on?'checked':''} onchange="toggleDate('\${d}')">\${d.slice(5)}\${nodata?' ·':''}</label>\`;
  }).join("");
  document.getElementById("ddpanel").innerHTML=
    '<div class="ddhead"><button onclick="allDates(true)">전체선택</button><button onclick="allDates(false)">전체해제</button></div>'+
    '<div class="ddgrid">'+items+'</div>';
}
function toggleDate(d){selectedDates.has(d)?selectedDates.delete(d):selectedDates.add(d);expanded.clear();renderChips();rebuild();}
function allDates(on){selectedDates.clear();if(on)DATE_OPTIONS.forEach(d=>selectedDates.add(d));expanded.clear();renderChips();rebuild();}
function toggleDD(e){e.stopPropagation();document.getElementById("ddpanel").classList.toggle("open");}
document.addEventListener("click",e=>{if(!document.getElementById("dateDD").contains(e.target))document.getElementById("ddpanel").classList.remove("open");});

// 국가 필터 드롭다운 (검색 지원 — 국가 수가 많아 체크박스만으로는 찾기 어려움)
function updateCCount(){document.getElementById("ccount").textContent=selectedCountries.size===COUNTRY_OPTIONS.length?"(전체)":"("+selectedCountries.size+")";}
function renderCountryGrid(){
  const q=countrySearch.trim().toLowerCase();
  const filtered=q?COUNTRY_OPTIONS.filter(c=>c.toLowerCase().includes(q)):COUNTRY_OPTIONS;
  document.getElementById("cgrid").innerHTML=filtered.length?filtered.map(c=>{
    const on=selectedCountries.has(c);
    return \`<label class="ddi"><input type="checkbox" \${on?'checked':''} onchange="toggleCountry('\${c}')">\${countryLabel(c)}</label>\`;
  }).join(""):'<div class="ddempty">검색 결과 없음</div>';
}
function renderCountryPanel(){
  document.getElementById("cddpanel").innerHTML=
    '<div class="ddhead"><button onclick="allCountries(true)">전체선택</button><button onclick="allCountries(false)">전체해제</button></div>'+
    '<input class="ddsearch" type="text" placeholder="국가 코드 검색 (예: US, KR)" oninput="onCountrySearch(event)">'+
    '<div class="ddgrid" id="cgrid"></div>';
  updateCCount();renderCountryGrid();
}
function onCountrySearch(e){countrySearch=e.target.value;renderCountryGrid();}
function toggleCountry(c){selectedCountries.has(c)?selectedCountries.delete(c):selectedCountries.add(c);updateCCount();expanded.clear();rebuild();}
function allCountries(on){selectedCountries.clear();if(on)COUNTRY_OPTIONS.forEach(c=>selectedCountries.add(c));updateCCount();renderCountryGrid();expanded.clear();rebuild();}
function toggleCountryDD(e){e.stopPropagation();document.getElementById("cddpanel").classList.toggle("open");}
document.addEventListener("click",e=>{if(!document.getElementById("countryDD").contains(e.target))document.getElementById("cddpanel").classList.remove("open");});

// ══ Summary 탭: 국가별 일자 추이 — Data Table 탭과 독립적인 자체 설치일/국가 필터 ══
let sumSelectedDates=new Set(DATE_OPTIONS);
let sumSelectedCountries=new Set(TOP_COUNTRIES.filter(c=>COUNTRY_OPTIONS.includes(c)));
let sumCountrySearch="";
// 국가별 Total/iOS/Android 그래프 전환(사용자 요청) — 국가마다 독립적으로 선택 상태를 기억한다.
// Total = iOS+Android 합계(기존 동작과 동일, os 필터 없음).
const sumOsFilter={};
function setSumOs(country,os){ sumOsFilter[country]=os; renderSummary(); }

function sumIndexTo100(vals){
  const nums=vals.filter(v=>v!=null&&isFinite(v)&&v>0);
  const max=nums.length?Math.max(...nums):0;
  return vals.map(v=>(v==null||max<=0)?null:(v/max*100));
}
function sumCountryDaily(country,dates,osOverride){
  const os=osOverride!==undefined?osOverride:(sumOsFilter[country]||"ALL");
  const byDate={};
  for(const d of dates)byDate[d]={cost:0,install_total:0,rev_d1_iaa:0,rev_d1_iap:0};
  for(const r of RAW){
    if(r.country!==country||!byDate[r.date])continue;
    if(os!=="ALL"&&r.os!==os)continue;
    const b=byDate[r.date];
    b.cost+=r.cost; b.install_total+=r.install_total;
    b.rev_d1_iaa+=r.rev_d1_iaa; b.rev_d1_iap+=r.rev_d1_iap;
  }
  return dates.map(d=>{
    const b=byDate[d], rev_d1=b.rev_d1_iaa+b.rev_d1_iap;
    return {
      date:d, cost:b.cost, install_total:b.install_total,
      cpi: b.install_total>0?b.cost/b.install_total:null,
      roas_d1: b.cost>0&&rev_d1>0?rev_d1/b.cost*100:null,
      rev_d1_iaa:b.rev_d1_iaa, rev_d1_iap:b.rev_d1_iap,
    };
  });
}

// Install Total(막대)+Total CPI(선) — 서로 다른 단위를 함께 보기 위해 각자 최댓값 기준 0~100% 인덱스
function sumChartInstallCpi(series){
  const W=560,H=180,padL=8,padR=8,padT=14,padB=26;
  const plotW=W-padL-padR, plotH=H-padT-padB, n=series.length||1;
  const xStep=plotW/n;
  const barW=Math.max(3,Math.min(16,xStep*0.5));
  const install=sumIndexTo100(series.map(s=>s.install_total));
  const cpi=sumIndexTo100(series.map(s=>s.cpi));
  const baseY=padT+plotH;
  // 막대(Install)와 선(CPI)이 겹치지 않도록 세로 공간을 두 밴드로 분리 — 막대는 아래쪽 55%,
  // 선은 위쪽 나머지(간격 10px 제외)만 사용해, 데이터 값과 무관하게 항상 서로 떨어져 있음.
  const bandGap=10;
  const barBandH=plotH*0.55;
  const lineBandH=plotH-barBandH-bandGap;
  const lineBandBottom=padT+lineBandH; // 선 밴드: padT(위,100%) ~ lineBandBottom(아래,0%)
  const showVal=xStep>=24;
  let bars="",ticks="";
  series.forEach((s,i)=>{
    const cx=padL+xStep*i+xStep/2;
    if(install[i]!=null){
      const h=(install[i]/100)*barBandH;
      bars+=\`<rect x="\${(cx-barW/2).toFixed(1)}" y="\${(baseY-h).toFixed(1)}" width="\${barW.toFixed(1)}" height="\${h.toFixed(1)}" rx="1.5" fill="var(--c-install)"><title>\${s.date} Install Total \${s.install_total.toLocaleString()}</title></rect>\`;
      if(showVal)bars+=\`<text x="\${cx.toFixed(1)}" y="\${(baseY-h-3).toFixed(1)}" font-size="8" fill="var(--muted)" text-anchor="middle">\${s.install_total.toLocaleString()}</text>\`;
    }
    ticks+=\`<text x="\${cx.toFixed(1)}" y="\${H-6}" font-size="8" fill="var(--muted)" text-anchor="middle">\${s.date.slice(5)}</text>\`;
  });
  let cpiPath="",cpiLabels="";
  cpi.forEach((v,i)=>{
    if(v==null)return;
    const x=padL+xStep*i+xStep/2, y=lineBandBottom-(v/100)*lineBandH;
    cpiPath+=(cpiPath?"L":"M")+x.toFixed(1)+","+y.toFixed(1)+" ";
    if(showVal&&series[i].cpi!=null)cpiLabels+=\`<text x="\${x.toFixed(1)}" y="\${(y-6).toFixed(1)}" font-size="8" fill="var(--c-cpi)" text-anchor="middle">$\${series[i].cpi.toFixed(2)}</text>\`;
  });
  return \`<svg viewBox="0 0 \${W} \${H}" class="mini-chart" preserveAspectRatio="none">
    <line x1="\${padL}" y1="\${baseY}" x2="\${W-padR}" y2="\${baseY}" stroke="var(--grid)" stroke-width="1"/>
    \${bars}
    \${cpiPath?\`<path d="\${cpiPath.trim()}" fill="none" stroke="var(--c-cpi)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>\`:""}
    \${cpiLabels}
    \${ticks}
  </svg>\`;
}

// D1 Rev(IAA+IAP 누적 막대)+D1 ROAS(선) — 역시 각자 최댓값 기준 인덱스.
// 막대와 선이 겹치지 않도록 세로 공간을 두 밴드로 분리(아래 55% 막대 / 위쪽+10px 간격 선).
function sumChartRevRoas(series){
  const W=560,H=180,padL=8,padR=8,padT=14,padB=26;
  const plotW=W-padL-padR, plotH=H-padT-padB, n=series.length||1;
  const xStep=plotW/n;
  const barW=Math.max(3,Math.min(16,xStep*0.5));
  const revTotal=series.map(s=>s.rev_d1_iaa+s.rev_d1_iap);
  const revIdx=sumIndexTo100(revTotal);
  const roas=sumIndexTo100(series.map(s=>s.roas_d1));
  const baseY=padT+plotH;
  const bandGap=10;
  const barBandH=plotH*0.55;
  const lineBandH=plotH-barBandH-bandGap;
  const lineBandBottom=padT+lineBandH; // 선 밴드: padT(위,100%) ~ lineBandBottom(아래,0%)
  const showVal=xStep>=24;
  let bars="",ticks="";
  series.forEach((s,i)=>{
    const cx=padL+xStep*i+xStep/2;
    const rt=revTotal[i];
    if(revIdx[i]!=null&&rt>0){
      const totalH=(revIdx[i]/100)*barBandH;
      const iaaFrac=s.rev_d1_iaa/rt, iapFrac=1-iaaFrac;
      const gap=(totalH>6&&iaaFrac>0&&iapFrac>0)?2:0;
      const iaaH=Math.max(0,totalH*iaaFrac-gap/2);
      const iapH=Math.max(0,totalH*iapFrac-gap/2);
      if(iaaH>0)bars+=\`<rect x="\${(cx-barW/2).toFixed(1)}" y="\${(baseY-iaaH).toFixed(1)}" width="\${barW.toFixed(1)}" height="\${iaaH.toFixed(1)}" rx="1.5" fill="var(--c-iaa)"><title>\${s.date} D1 IAA $\${s.rev_d1_iaa.toFixed(2)}</title></rect>\`;
      if(iapH>0)bars+=\`<rect x="\${(cx-barW/2).toFixed(1)}" y="\${(baseY-iaaH-gap-iapH).toFixed(1)}" width="\${barW.toFixed(1)}" height="\${iapH.toFixed(1)}" rx="1.5" fill="var(--c-iap)"><title>\${s.date} D1 IAP $\${s.rev_d1_iap.toFixed(2)}</title></rect>\`;
      if(showVal)bars+=\`<text x="\${cx.toFixed(1)}" y="\${(baseY-iaaH-gap-iapH-3).toFixed(1)}" font-size="8" fill="var(--muted)" text-anchor="middle">$\${rt.toFixed(0)}</text>\`;
    }
    ticks+=\`<text x="\${cx.toFixed(1)}" y="\${H-6}" font-size="8" fill="var(--muted)" text-anchor="middle">\${s.date.slice(5)}</text>\`;
  });
  let roasPath="",roasLabels="";
  roas.forEach((v,i)=>{
    if(v==null)return;
    const x=padL+xStep*i+xStep/2, y=lineBandBottom-(v/100)*lineBandH;
    roasPath+=(roasPath?"L":"M")+x.toFixed(1)+","+y.toFixed(1)+" ";
    if(showVal&&series[i].roas_d1!=null)roasLabels+=\`<text x="\${x.toFixed(1)}" y="\${(y-6).toFixed(1)}" font-size="8" fill="var(--c-roas)" text-anchor="middle">\${series[i].roas_d1.toFixed(0)}%</text>\`;
  });
  return \`<svg viewBox="0 0 \${W} \${H}" class="mini-chart" preserveAspectRatio="none">
    <line x1="\${padL}" y1="\${baseY}" x2="\${W-padR}" y2="\${baseY}" stroke="var(--grid)" stroke-width="1"/>
    \${bars}
    \${roasPath?\`<path d="\${roasPath.trim()}" fill="none" stroke="var(--c-roas)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>\`:""}
    \${roasLabels}
    \${ticks}
  </svg>\`;
}

function renderSummary(){
  const dates=DATE_OPTIONS.filter(d=>sumSelectedDates.has(d));
  const countries=[...sumSelectedCountries].filter(c=>COUNTRY_OPTIONS.includes(c));
  const withCost=countries.map(c=>{
    const series=sumCountryDaily(c,dates);
    const cost=series.reduce((s,x)=>s+x.cost,0);
    // 정렬 기준은 OS 버튼(Total/iOS/Android)과 무관하게 항상 전체(ALL) Install Total로 고정한다
    // (사용자 피드백 — 버튼을 누를 때마다 국가 섹션 순서가 바뀌던 문제).
    const installTotal=sumCountryDaily(c,dates,"ALL").reduce((s,x)=>s+x.install_total,0);
    return {country:c,series,cost,installTotal};
  }).sort((a,b)=>b.installTotal-a.installTotal); // Install Total 내림차순 고정
  document.getElementById("summaryList").innerHTML=withCost.length?withCost.map(({country,series,cost})=>{
    const osSel=sumOsFilter[country]||"ALL";
    const osBtns=\`<div class="metric-filter">
      <button class="btn cm-filter-btn \${osSel==="ALL"?"active":""}" onclick="setSumOs('\${country}','ALL')">Total</button>
      <button class="btn cm-filter-btn \${osSel==="iOS"?"active":""}" onclick="setSumOs('\${country}','iOS')">iOS</button>
      <button class="btn cm-filter-btn \${osSel==="Android"?"active":""}" onclick="setSumOs('\${country}','Android')">Android</button>
    </div>\`;
    return \`
    <div class="country-row">
      <div class="country-row-head"><span class="country-row-title">\${countryLabel(country)}</span><span class="country-row-sub">Cost $\${cost.toLocaleString(undefined,{maximumFractionDigits:0})}</span></div>
      \${osBtns}
      <div class="country-charts">
        <div class="chart-panel"><div class="chart-panel-title">Install Total · Total CPI</div>\${sumChartInstallCpi(series)}</div>
        <div class="chart-panel"><div class="chart-panel-title">D1 Rev(IAA+IAP) · D1 ROAS</div>\${sumChartRevRoas(series)}</div>
      </div>
    </div>\`;
  }).join(""):'<p class="tabnote">선택된 국가가 없습니다.</p>';
}

function renderSumChips(){
  document.getElementById("sumddcount").textContent="("+sumSelectedDates.size+")";
  const items=DATE_OPTIONS.map(d=>{
    const on=sumSelectedDates.has(d);
    return \`<label class="ddi"><input type="checkbox" \${on?'checked':''} onchange="toggleSumDate('\${d}')">\${d.slice(5)}</label>\`;
  }).join("");
  document.getElementById("sumddpanel").innerHTML=
    '<div class="ddhead"><button onclick="allSumDates(true)">전체선택</button><button onclick="allSumDates(false)">전체해제</button></div>'+
    '<div class="ddgrid">'+items+'</div>';
}
function toggleSumDate(d){sumSelectedDates.has(d)?sumSelectedDates.delete(d):sumSelectedDates.add(d);renderSumChips();renderSummary();}
function allSumDates(on){sumSelectedDates.clear();if(on)DATE_OPTIONS.forEach(d=>sumSelectedDates.add(d));renderSumChips();renderSummary();}
function toggleSumDD(e){e.stopPropagation();document.getElementById("sumddpanel").classList.toggle("open");}
document.addEventListener("click",e=>{if(!document.getElementById("sumDateDD").contains(e.target))document.getElementById("sumddpanel").classList.remove("open");});

function updateSumCCount(){document.getElementById("sumccount").textContent="("+sumSelectedCountries.size+")";}
function renderSumCountryGrid(){
  const q=sumCountrySearch.trim().toLowerCase();
  const filtered=q?COUNTRY_OPTIONS.filter(c=>c.toLowerCase().includes(q)):COUNTRY_OPTIONS;
  document.getElementById("sumcgrid").innerHTML=filtered.length?filtered.map(c=>{
    const on=sumSelectedCountries.has(c);
    return \`<label class="ddi"><input type="checkbox" \${on?'checked':''} onchange="toggleSumCountry('\${c}')">\${countryLabel(c)}</label>\`;
  }).join(""):'<div class="ddempty">검색 결과 없음</div>';
}
function renderSumCountryPanel(){
  document.getElementById("sumcddpanel").innerHTML=
    '<div class="ddhead"><button onclick="allSumCountries(true)">전체선택</button><button onclick="allSumCountries(false)">전체해제</button></div>'+
    '<input class="ddsearch" type="text" placeholder="국가 코드 검색 (예: US, KR)" oninput="onSumCountrySearch(event)">'+
    '<div class="ddgrid" id="sumcgrid"></div>';
  updateSumCCount();renderSumCountryGrid();
}
function onSumCountrySearch(e){sumCountrySearch=e.target.value;renderSumCountryGrid();}
function toggleSumCountry(c){sumSelectedCountries.has(c)?sumSelectedCountries.delete(c):sumSelectedCountries.add(c);updateSumCCount();renderSummary();}
function allSumCountries(on){sumSelectedCountries.clear();if(on)COUNTRY_OPTIONS.forEach(c=>sumSelectedCountries.add(c));updateSumCCount();renderSumCountryGrid();renderSummary();}
function toggleSumCountryDD(e){e.stopPropagation();document.getElementById("sumcddpanel").classList.toggle("open");}
document.addEventListener("click",e=>{if(!document.getElementById("sumCountryDD").contains(e.target))document.getElementById("sumcddpanel").classList.remove("open");});

// 세그먼트 순서 칩 (드래그 또는 ◀▶로 재정렬)
let dragKey=null;
function renderSegBar(){
  const el=document.getElementById("segbar");
  el.innerHTML=LEVELS.map((k,i)=>\`<div class="chip" draggable="true" data-k="\${k}"
      ondragstart="segDragStart(event)" ondragover="segDragOver(event)" ondragleave="segDragLeave(event)" ondrop="segDrop(event)" ondragend="segDragEnd(event)">
    <span class="chip-num">\${i+1}</span><span class="chip-label">\${DIM_META[k].label}</span>
    <span class="chip-btns">
      <button class="chip-btn" \${i===0?'disabled':''} onclick="moveSeg('\${k}',-1)" title="앞으로">◀</button>
      <button class="chip-btn" \${i===LEVELS.length-1?'disabled':''} onclick="moveSeg('\${k}',1)" title="뒤로">▶</button>
    </span>
  </div>\`).join("");
}
function moveSeg(k,dir){
  const i=LEVELS.indexOf(k), j=i+dir; if(j<0||j>=LEVELS.length)return;
  [LEVELS[i],LEVELS[j]]=[LEVELS[j],LEVELS[i]];
  segReordered();
}
function segDragStart(e){dragKey=e.currentTarget.dataset.k;e.currentTarget.classList.add("dragging");e.dataTransfer.effectAllowed="move";}
function segDragOver(e){e.preventDefault();e.dataTransfer.dropEffect="move";e.currentTarget.classList.add("over");}
function segDragLeave(e){e.currentTarget.classList.remove("over");}
function segDragEnd(e){e.currentTarget.classList.remove("dragging");document.querySelectorAll(".chip.over").forEach(c=>c.classList.remove("over"));}
function segDrop(e){
  e.preventDefault();
  const tgt=e.currentTarget.dataset.k; e.currentTarget.classList.remove("over");
  if(!dragKey||dragKey===tgt)return;
  const from=LEVELS.indexOf(dragKey), to=LEVELS.indexOf(tgt);
  LEVELS.splice(from,1); LEVELS.splice(to,0,dragKey);
  dragKey=null;
  segReordered();
}
function segReordered(){expanded.clear();renderSegBar();rebuild();}

// ══════════════════════════════════════════════════════════════════════════
// Data Table(소재·주차) 탭 — RAW2 전용. blank()/addInto()/derive()/fmt()/roasCls()/esc()/
// countryLabel()/MLABEL/MCOLOR는 Data Table 탭과 동일한 필드명을 쓰므로 그대로 재사용한다.
// ══════════════════════════════════════════════════════════════════════════
const COUNTRY_OPTIONS2=[...new Set(RAW2.map(r=>r.country))].sort();
const selectedCountries2=new Set(COUNTRY_OPTIONS2);
let countrySearch2="";
// 주차 필터(사용자 요청) — week 라벨은 "MM-DD~MM-DD" 형태라 문자열 오름차순 정렬이 곧 시간 순서.
const WEEK_OPTIONS2=[...new Set(RAW2.map(r=>r.week))].sort();
const selectedWeeks2=new Set(WEEK_OPTIONS2);
function updateWCount2(){document.getElementById("wdcount2").textContent=selectedWeeks2.size===WEEK_OPTIONS2.length?"(전체)":"("+selectedWeeks2.size+")";}
function renderWeekChips2(){
  updateWCount2();
  const items=WEEK_OPTIONS2.map(w=>{
    const on=selectedWeeks2.has(w);
    return \`<label class="ddi"><input type="checkbox" \${on?'checked':''} onchange="toggleWeek2('\${w}')">\${esc(w)}</label>\`;
  }).join("");
  document.getElementById("wdpanel2").innerHTML=
    '<div class="ddhead"><button onclick="allWeeks2(true)">전체선택</button><button onclick="allWeeks2(false)">전체해제</button></div>'+
    '<div class="ddgrid">'+items+'</div>';
}
function toggleWeek2(w){selectedWeeks2.has(w)?selectedWeeks2.delete(w):selectedWeeks2.add(w);expanded2.clear();renderWeekChips2();rebuild2();}
function allWeeks2(on){selectedWeeks2.clear();if(on)WEEK_OPTIONS2.forEach(w=>selectedWeeks2.add(w));expanded2.clear();renderWeekChips2();rebuild2();}
function toggleWeekDD2(e){e.stopPropagation();document.getElementById("wdpanel2").classList.toggle("open");}
document.addEventListener("click",e=>{if(!document.getElementById("weekDD2").contains(e.target))document.getElementById("wdpanel2").classList.remove("open");});
const collapsedGroups2=new Set(["d1","d3","d7","d14","d21","d30","rev"]);
function visibleMetrics2(){return METRICS2.filter(m=>!(m.grp&&collapsedGroups2.has(m.grp)));}
function toggleGroup2(g){collapsedGroups2.has(g)?collapsedGroups2.delete(g):collapsedGroups2.add(g);render2();}
// 자식 서브트리 전체의 depth를 delta만큼 옮긴다(뎁스 중복 병합 시, 건너뛴 한 뎁스만큼
// 들여쓰기/lvl 클래스를 다시 맞추기 위함).
function shiftDepth2(nodes,delta){
  if(!nodes)return nodes;
  for(const n of nodes){ n.depth+=delta; shiftDepth2(n.children,delta); }
  return nodes;
}
let idc2=0;
function build2(rows,depth){
  const ACT=activeLevels2();
  if(depth>=ACT.length)return null;
  const key=ACT[depth];
  const nextKey=ACT[depth+1];
  const groups={};
  for(const r of rows){(groups[r[key]]=groups[r[key]]||[]).push(r);}
  const nodes=[];
  for(const [val,rs] of Object.entries(groups)){
    const agg=blank();for(const r of rs)addInto(agg,r);derive(agg);
    let children=build2(rs,depth+1);
    // 소재카테고리↔소재 뎁스 중복 병합(사용자 요청): 소재카테고리가 "core"인 그룹의 소재가 딱
    // 하나뿐이고 그 값도 "core"처럼 부모와 완전히 같으면(Google adgroup명이 대표적), 똑같은 라벨을
    // 한 번 더 클릭해야 해서 헷갈린다. 이런 경우 그 소재 뎁스를 건너뛰고 자식들을 바로 이 노드
    // 밑에 이어붙인다(칩을 드래그해 소재→소재카테고리 순서가 되어도 반대 방향으로 동일하게 동작).
    const isTypeCreativePair=(key==="creative_cat"&&nextKey==="creative")||(key==="creative"&&nextKey==="creative_cat");
    if(isTypeCreativePair && children && children.length===1 && String(children[0].value).toLowerCase()===String(val).toLowerCase()){
      children=shiftDepth2(children[0].children,-1);
    }
    const node={id:++idc2,dim:key,value:val,depth,...agg,children};
    nodes.push(node);
  }
  if(key==="week")nodes.sort((a,b)=>String(a.value).localeCompare(String(b.value))); // 오름차순
  else nodes.sort((a,b)=>b.cost-a.cost || b.install_total-a.install_total);
  return nodes;
}
let TREE2=[];
function rebuild2(){
  idc2=0;
  TREE2=build2(RAW2.filter(r=>selectedCountries2.has(r.country)&&selectedWeeks2.has(r.week)),0);
  render2();
  renderTopSpenders2();
}
const expanded2=new Set();
function dimLabel2(node){
  const v=node.value;
  if(node.dim==="paid_org")return \`<span class="po-pill po-\${esc(v)}">\${esc(v)}</span>\`;
  if(node.dim==="media")return \`<span class="dot" style="background:\${MCOLOR[v]||'var(--organic)'}"></span>\${esc(MLABEL[v]||v)}\`;
  if(node.dim==="os")return \`<span class="os-pill os-\${esc(v)}">\${esc(v)}</span>\`;
  if(node.dim==="creative_cat")return \`<span class="ctype-pill" style="border-color:\${CCAT_COLOR[v]||'var(--border2)'};color:\${CCAT_COLOR[v]||'var(--txt)'}">\${esc(v)}</span>\`;
  if(node.dim==="creative_format")return \`<span class="ctype-pill" style="border-color:\${CFMT_COLOR[v]||'var(--border2)'};color:\${CFMT_COLOR[v]||'var(--txt)'}">\${esc(v)}</span>\`;
  if(node.dim==="week")return esc(v);
  if(node.dim==="campaign"||node.dim==="creative")return \`<span class="camp" title="\${esc(v)}">\${esc(v)}</span>\`;
  return countryLabel(v);
}
function renderNodes2(nodes,rowsArr,metrics){
  for(const n of nodes){
    const hasKids=n.children&&n.children.length;
    const open=expanded2.has(n.id);
    let tds=\`<td class="left node \${hasKids?'':'leaf'} lvl\${n.depth}" style="padding-left:\${10+n.depth*20}px" \${hasKids?\`onclick="toggle2(\${n.id})"\`:''}>\`;
    tds+=\`<span class="caret" style="transform:rotate(\${open?90:0}deg)">\${hasKids?'▶':''}</span>\${dimLabel2(n)}</td>\`;
    for(const m of metrics){
      const cls=m.k.startsWith("roas")?roasCls(n[m.k]):"";
      tds+=\`<td class="\${cls} lvl\${n.depth}">\${fmt(n[m.k],m.type)}</td>\`;
    }
    rowsArr.push(\`<tr>\${tds}</tr>\`);
    if(hasKids&&open)renderNodes2(n.children,rowsArr,metrics);
  }
}
const GROUP_BUTTONS2=[{id:"revGroupBtn2",grp:"rev",label:"매출 지표"},{id:"rrGroupBtn2",grp:"rr",label:"RR 지표"}];
function updateGroupBtn2(){
  for(const g of GROUP_BUTTONS2){
    const count=METRICS2.filter(m=>m.grp===g.grp).length;
    const collapsed=collapsedGroups2.has(g.grp);
    document.getElementById(g.id).textContent=collapsed?\`\${g.label} 펼치기 (\${count})\`:\`\${g.label} 접기\`;
  }
}
function render2(){
  const total=blank();for(const r of RAW2)if(selectedCountries2.has(r.country)&&selectedWeeks2.has(r.week))addInto(total,r);derive(total);
  const vis=visibleMetrics2();
  let h='<thead><tr><th class="left">구분</th>'+vis.map(m=>{
    const cls=m.hg?'th-'+m.hg:'';
    if(m.ctrlGrp){
      const open=!collapsedGroups2.has(m.ctrlGrp);
      return \`<th class="\${cls} th-toggle-parent" onclick="toggleGroup2('\${m.ctrlGrp}')"><span class="th-caret" style="transform:rotate(\${open?90:0}deg)">▶</span>\${m.label}</th>\`;
    }
    return \`<th class="\${cls}">\${m.label}</th>\`;
  }).join("")+'</tr></thead><tbody>';
  h+='<tr class="grand-total"><td class="left">전체 합계</td>';
  for(const m of vis)h+=\`<td>\${fmt(total[m.k],m.type)}</td>\`;
  h+='</tr>';
  const arr=[];renderNodes2(TREE2,arr,vis);h+=arr.join("");
  h+='</tbody>';
  updateGroupBtn2();
  const tbl=document.getElementById("tbl2");
  tbl.innerHTML=h;
  const headTr=tbl.querySelector("thead tr");
  if(headTr) tbl.style.setProperty("--head-h", headTr.getBoundingClientRect().height+"px");
}
// ══ Top Spender 소재 패널(사용자 요청) — 주차를 특정 구간으로 좁혔을 때만, 매체×캠페인별로
// Cost가 가장 높았던 소재 1개씩을 뽑아 상단에 강조 표시한다(전체 주차 선택 시에는 의미가
// 옅어지고 캠페인 수만큼 행이 늘어나 숨김). share%는 그 소재의 Cost가 같은 매체×캠페인
// 전체 Cost 중 얼마를 차지하는지(해당 소재로의 예산 집중도)를 보여준다.
function computeTopSpenders2(rows){
  const groupCost={}, cell={};
  for(const r of rows){
    const gk=r.media+"|||"+r.campaign;
    groupCost[gk]=(groupCost[gk]||0)+r.cost;
    const ck=gk+"|||"+r.creative;
    if(!cell[ck])cell[ck]={media:r.media,campaign:r.campaign,creative:r.creative,creative_cat:r.creative_cat,cost:0,install_total:0,rev_d1:0,rev_d3:0,rev_d7:0,imp:0,clk:0};
    const b=cell[ck];
    b.cost+=r.cost; b.install_total+=r.install_total; b.rev_d1+=r.rev_d1; b.rev_d3+=(r.rev_d3||0); b.rev_d7+=(r.rev_d7||0);
    b.imp+=(r.imp||0); b.clk+=(r.clk||0);
  }
  const top={};
  for(const b of Object.values(cell)){
    const gk=b.media+"|||"+b.campaign;
    if(!top[gk]||b.cost>top[gk].cost)top[gk]=b;
  }
  return Object.values(top).filter(b=>b.cost>0).map(b=>{
    const gk=b.media+"|||"+b.campaign, gCost=groupCost[gk]||0;
    return {...b,
      group_cost:gCost, share:gCost>0?b.cost/gCost*100:null,
      cpi:b.install_total>0?b.cost/b.install_total:null,
      roas_d1:b.cost>0&&b.rev_d1>0?b.rev_d1/b.cost*100:null,
      roas_d7:b.cost>0&&b.rev_d7>0?b.rev_d7/b.cost*100:null,
      cpm:b.imp>0?b.cost/b.imp*1000:null,
      ctr:b.imp>0?b.clk/b.imp*100:null,
      cpc:b.clk>0?b.cost/b.clk:null,
      cvr:b.clk>0?b.install_total/b.clk*100:null,
    };
  }).sort((a,b)=>b.cost-a.cost);
}
function renderTopSpenders2(){
  const el=document.getElementById("topSpenders2");
  const narrowed=selectedWeeks2.size<WEEK_OPTIONS2.length;
  if(!narrowed){
    el.innerHTML='<div class="topspend-hint">주차 필터에서 특정 주차를 선택하면, 매체×캠페인별 Cost 소진이 가장 높았던 소재를 여기에 정리해서 보여드립니다.</div>';
    return;
  }
  const rows=RAW2.filter(r=>selectedCountries2.has(r.country)&&selectedWeeks2.has(r.week));
  const top=computeTopSpenders2(rows);
  if(!top.length){ el.innerHTML='<div class="topspend-hint">선택한 주차·국가 범위에 표시할 데이터가 없습니다.</div>'; return; }
  const weekTxt=[...selectedWeeks2].sort().join(", ");
  let h=\`<div class="topspend-head">🏆 매체×캠페인별 Top Spender 소재 <span class="topspend-week">(선택 주차: \${esc(weekTxt)})</span></div>\`;
  h+='<div class="topspend-wrap"><table class="topspend-tbl"><thead><tr>'+
     '<th class="left">매체</th><th class="left">캠페인</th><th class="left">Top 소재</th><th>카테고리</th>'+
     '<th>Cost</th><th>캠페인 내 비중</th><th>Install</th><th>CPI</th><th>D1 ROAS</th><th>D7 ROAS</th>'+
     '<th>Imp</th><th>CPM</th><th>CTR</th><th>CPC</th><th>CVR</th>'+
     '</tr></thead><tbody>';
  for(const b of top){
    h+=\`<tr>
      <td class="left"><span class="dot" style="background:\${MCOLOR[b.media]||'var(--organic)'}"></span>\${esc(MLABEL[b.media]||b.media)}</td>
      <td class="left"><span class="camp" title="\${esc(b.campaign)}">\${esc(b.campaign)}</span></td>
      <td class="left"><span class="camp" title="\${esc(b.creative)}">\${esc(b.creative)}</span></td>
      <td><span class="ctype-pill" style="border-color:\${CCAT_COLOR[b.creative_cat]||'var(--border2)'};color:\${CCAT_COLOR[b.creative_cat]||'var(--txt)'}">\${esc(b.creative_cat)}</span></td>
      <td class="topspend-cost">\${fmt(b.cost,"$")}</td>
      <td>\${fmt(b.share,"%")}</td>
      <td>\${fmt(b.install_total,"n")}</td>
      <td>\${fmt(b.cpi,"$")}</td>
      <td class="\${roasCls(b.roas_d1)}">\${fmt(b.roas_d1,"%")}</td>
      <td class="\${roasCls(b.roas_d7)}">\${fmt(b.roas_d7,"%")}</td>
      <td>\${fmt(b.imp,"n")}</td>
      <td>\${fmt(b.cpm,"$")}</td>
      <td>\${fmt(b.ctr,"%")}</td>
      <td>\${fmt(b.cpc,"$")}</td>
      <td>\${fmt(b.cvr,"%")}</td>
    </tr>\`;
  }
  h+='</tbody></table></div>';
  el.innerHTML=h;
}
function toggle2(id){expanded2.has(id)?expanded2.delete(id):expanded2.add(id);render2();}
function allIds2(nodes,acc){for(const n of nodes){if(n.children&&n.children.length){acc.push(n.id);allIds2(n.children,acc);}}return acc;}
function expandAll2(){allIds2(TREE2,[]).forEach(id=>expanded2.add(id));render2();}
function collapseAll2(){expanded2.clear();render2();}

function updateCCount2(){document.getElementById("ccount2").textContent=selectedCountries2.size===COUNTRY_OPTIONS2.length?"(전체)":"("+selectedCountries2.size+")";}
function renderCountryGrid2(){
  const q=countrySearch2.trim().toLowerCase();
  const filtered=q?COUNTRY_OPTIONS2.filter(c=>c.toLowerCase().includes(q)):COUNTRY_OPTIONS2;
  document.getElementById("cgrid2").innerHTML=filtered.length?filtered.map(c=>{
    const on=selectedCountries2.has(c);
    return \`<label class="ddi"><input type="checkbox" \${on?'checked':''} onchange="toggleCountry2('\${c}')">\${countryLabel(c)}</label>\`;
  }).join(""):'<div class="ddempty">검색 결과 없음</div>';
}
function renderCountryPanel2(){
  document.getElementById("cddpanel2").innerHTML=
    '<div class="ddhead"><button onclick="allCountries2(true)">전체선택</button><button onclick="allCountries2(false)">전체해제</button></div>'+
    '<input class="ddsearch" type="text" placeholder="국가 코드 검색 (예: US, KR)" oninput="onCountrySearch2(event)">'+
    '<div class="ddgrid" id="cgrid2"></div>';
  updateCCount2();renderCountryGrid2();
}
function onCountrySearch2(e){countrySearch2=e.target.value;renderCountryGrid2();}
function toggleCountry2(c){selectedCountries2.has(c)?selectedCountries2.delete(c):selectedCountries2.add(c);updateCCount2();expanded2.clear();rebuild2();}
function allCountries2(on){selectedCountries2.clear();if(on)COUNTRY_OPTIONS2.forEach(c=>selectedCountries2.add(c));updateCCount2();renderCountryGrid2();expanded2.clear();rebuild2();}
function toggleCountryDD2(e){e.stopPropagation();document.getElementById("cddpanel2").classList.toggle("open");}
document.addEventListener("click",e=>{if(!document.getElementById("countryDD2").contains(e.target))document.getElementById("cddpanel2").classList.remove("open");});

let dragKey2=null;
// 활성 세그먼트만 칩으로 표시한다(비활성은 "세그먼트 선택" 드롭다운에서 다시 켤 수 있음).
function renderSegBar2(){
  const el=document.getElementById("segbar2");
  const act=activeLevels2();
  el.innerHTML=act.map((k,i)=>\`<div class="chip" draggable="true" data-k="\${k}"
      ondragstart="segDragStart2(event)" ondragover="segDragOver2(event)" ondragleave="segDragLeave2(event)" ondrop="segDrop2(event)" ondragend="segDragEnd2(event)">
    <span class="chip-num">\${i+1}</span><span class="chip-label">\${DIM_META2[k].label}</span>
    <span class="chip-btns">
      <button class="chip-btn" \${i===0?'disabled':''} onclick="moveSeg2('\${k}',-1)" title="앞으로">◀</button>
      <button class="chip-btn" \${i===act.length-1?'disabled':''} onclick="moveSeg2('\${k}',1)" title="뒤로">▶</button>
      <button class="chip-btn" \${act.length<=1?'disabled':''} onclick="toggleSeg2('\${k}')" title="이 세그먼트 빼기">✕</button>
    </span>
  </div>\`).join("");
  renderSegPanel2();
}
// 세그먼트 선택 드롭다운: 어떤 세그먼트를 트리 뎁스로 쓸지 고른다. 최소 1개는 남겨야 하므로
// 마지막 하나 남았을 때는 해제를 막는다.
function renderSegPanel2(){
  const act=activeLevels2();
  document.getElementById("segcount2").textContent=
    act.length===LEVELS2.length?"(전체)":"("+act.length+"/"+LEVELS2.length+")";
  document.getElementById("segpanel2").innerHTML=
    '<div class="ddhead"><button onclick="allSegs2(true)">전체선택</button></div>'+
    '<div class="ddgrid">'+LEVELS2.map(k=>{
      const on=ACTIVE2.has(k), lock=on&&act.length<=1;
      return \`<label class="ddi"><input type="checkbox" \${on?'checked':''} \${lock?'disabled':''} onchange="toggleSeg2('\${k}')">\${esc(DIM_META2[k].label)}</label>\`;
    }).join("")+'</div>';
}
function toggleSeg2(k){
  if(ACTIVE2.has(k)){ if(activeLevels2().length<=1)return; ACTIVE2.delete(k); }
  else ACTIVE2.add(k);
  segReordered2();
}
function allSegs2(on){ ACTIVE2=new Set(on?LEVELS2:[LEVELS2[0]]); segReordered2(); }
function toggleSegDD2(e){e.stopPropagation();document.getElementById("segpanel2").classList.toggle("open");}
document.addEventListener("click",e=>{if(!document.getElementById("segDD2").contains(e.target))document.getElementById("segpanel2").classList.remove("open");});
// 순서 변경은 활성 목록 기준으로 하고, 비활성 세그먼트는 뒤에 붙여 순서 정보를 보존한다.
function reorderActive2(act){ LEVELS2=[...act,...LEVELS2.filter(x=>!ACTIVE2.has(x))]; }
function moveSeg2(k,dir){
  const act=activeLevels2();
  const i=act.indexOf(k), j=i+dir; if(j<0||j>=act.length)return;
  [act[i],act[j]]=[act[j],act[i]];
  reorderActive2(act);
  segReordered2();
}
function segDragStart2(e){dragKey2=e.currentTarget.dataset.k;e.currentTarget.classList.add("dragging");e.dataTransfer.effectAllowed="move";}
function segDragOver2(e){e.preventDefault();e.dataTransfer.dropEffect="move";e.currentTarget.classList.add("over");}
function segDragLeave2(e){e.currentTarget.classList.remove("over");}
function segDragEnd2(e){e.currentTarget.classList.remove("dragging");document.querySelectorAll(".chip.over").forEach(c=>c.classList.remove("over"));}
function segDrop2(e){
  e.preventDefault();
  const tgt=e.currentTarget.dataset.k; e.currentTarget.classList.remove("over");
  if(!dragKey2||dragKey2===tgt)return;
  const act=activeLevels2();
  const from=act.indexOf(dragKey2), to=act.indexOf(tgt);
  act.splice(from,1); act.splice(to,0,dragKey2);
  reorderActive2(act);
  dragKey2=null;
  segReordered2();
}
function segReordered2(){expanded2.clear();renderSegBar2();rebuild2();}

function showTab(name){
  document.querySelectorAll(".tabpanel").forEach(el=>el.classList.remove("active"));
  document.querySelectorAll(".tabbtn").forEach(el=>el.classList.remove("active"));
  document.getElementById("tab-"+name).classList.add("active");
  document.getElementById("tabbtn-"+name).classList.add("active");
  // Data Table 탭은 기본적으로 숨겨져 있어 초기 렌더 시 헤더 높이 측정(--head-h)이 0으로 잡힐 수 있음
  // — 탭이 실제로 보이게 된 시점에 다시 그려서 전체 합계 행의 sticky 오프셋을 바로잡는다.
  if(name==="table")render();
  if(name==="creative")render2();
}
renderSegBar();renderChips();renderCountryPanel();rebuild();
renderSumChips();renderSumCountryPanel();renderSummary();
renderSegBar2();renderCountryPanel2();renderWeekChips2();rebuild2();
</script>`;
writeFileSync(OUT, html, "utf8");
process.stdout.write("written len="+html.length+"\\n");
