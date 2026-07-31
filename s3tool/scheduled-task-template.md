---
name: geo-cohort-daily-update
description: 국가/OS/매체/일자별 성과 + IAA 광고형식 분석 대시보드 2종을 매일 오전 11시에 갱신·재게시
---

Idol Farm Life(AppsFlyer Data Locker) 대시보드 2종의 데이터를 갱신하고 각각 기존 아티팩트 URL로 재게시하는 작업이다. 매일 오전 11시 실행된다. 모든 스크립트는 완성되어 있으니 수정하지 말고 실행만 한다. 대상 기간은 각 수집 스크립트가 자동으로 `2026-07-07 ~ 전일(KST)`로 계산한다.

## 대시보드 A — 국가/OS/매체/일자별 성과

1. PowerShell: `cd <이 저장소 경로>\s3tool; node geo-cohort-os.mjs 2>$null`
   - 결과: `<이 저장소 경로>\s3tool\geo-cohort-os-result.json`, stdout에 `rows: N`과 OS별/IAP·IAA 총액 출력.
2. PowerShell: `cd <이 저장소 경로>\s3tool; node gen-tree-artifact.mjs`
   - 생성: scratchpad 경로에 `geo-cohort-table.html`
3. Artifact 도구로 재게시(기존 URL 유지 필수):
   - file_path: 위 geo-cohort-table.html
   - url: `https://claude.ai/code/artifact/77231e16-3795-4fc0-b305-9223ac6a9c24`
   - favicon: 📊, description: "국가/OS/매체/일자별 성과 — 매일 오전 11시 갱신"

## 대시보드 B — IAA 광고매출 형식 분석 (일자›국가›형식›매체)

4. PowerShell: `cd <이 저장소 경로>\s3tool; node collect-format-tree.mjs 2>$null`
   - 결과: `<이 저장소 경로>\s3tool\format-tree-result.json`, stdout에 `rows: N`과 총 D1 IAA 출력.
5. PowerShell: `cd <이 저장소 경로>\s3tool; node gen-format-tree.mjs`
   - 생성: scratchpad 경로에 `format-tree.html`
6. Artifact 도구로 재게시(기존 URL 유지 필수):
   - file_path: 위 format-tree.html
   - url: `https://claude.ai/code/artifact/a9fbdb1f-8bf6-4641-91e6-c34b536f52a1`
   - favicon: 📺, description: "IAA 광고매출 형식 분석 — 일자›국가›형식›매체"

## 성공 기준
- 두 result JSON의 rows가 정상(수백~천 단위), 종료일이 전일까지 포함
- 두 아티팩트가 각각 기존 URL(77231e16-…, a9fbdb1f-…)에 in-place 갱신
- 코호트 경과로 D1/D3 누적치가 이전보다 갱신(누적은 증가 또는 유지)

## 데이터 정의(참고)
- 설치일(코호트) 기준. D1=(D0~D1 누적), D3=(D0~D3 누적). event_time이 install_time보다 앞서면 Day0로 clamp.
- 매출=IAP(af_purchase)+IAA(ad_revenue_v2, 최신 version만). cost_etl_summary는 최신 dt=·최대 v=만.
- SKAN 설치는 캠페인명으로 국가(US/JP/KR/WW) 귀속, af_attribution_flag=true 제외. 미상 국가 제외.
- 대시보드 B는 IAA만, 형식=af_ad_type. eCPM/노출은 참고용(impressions 컬럼이 세분 단위에서 부정확).

## 주의
- 스크립트(geo-cohort-os.mjs, gen-tree-artifact.mjs, collect-format-tree.mjs, gen-format-tree.mjs) 수정 금지, 실행만.
- 단계별 실패 시 어느 단계·오류 메시지를 함께 보고한다.

---

이 파일은 `~/.claude/scheduled-tasks/geo-cohort-daily-update/SKILL.md`의 원본 템플릿입니다(머신별 상태라 git으로 관리되지 않으므로 참고용으로 저장소에 보관). 현재 이 자동화는 회사 PC에만 등록되어 있으며, 집 PC 등 추가 clone에는 등록하지 않는다(동시 실행 시 같은 아티팩트 URL에 중복 재게시 충돌). 회사 PC를 교체하거나 스케줄을 다른 PC로 옮겨야 할 때만, 그 PC의 Claude Code에서 `/schedule`을 실행하고 위 내용을 프롬프트로 붙여넣되 `<이 저장소 경로>`를 그 PC의 실제 clone 경로로 바꿔서 전달하세요.
