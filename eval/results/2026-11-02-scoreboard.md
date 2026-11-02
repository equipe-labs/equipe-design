# equipe-design 정확도 평가 — 2026-11-02

실행 폴더: `eval/out/2026-11-02`. 정답: `eval/answers/<host>.json`. 지표 정의: 설계 README 5.2, 이 폴더의 `eval/README.md`.

| 사이트 | 지표 | equipe-design | designlang 13.3.2 | Dembrandt 0.39.2 | 목표 |
|---|---|---|---|---|---|
| equipe.im | 간격 재현율 · 정밀도 | 9/9 · 9/9 | 3/9 · 3/24 | 9/9 · 9/20 | 9/9 · ≥ 0.75 |
| equipe.im | 반경 재현율 · 정밀도 | 4/5 · 4/6 | 1/5 · 1/10 | 4/5 · 4/15 | ≥ 4/5 · ≥ 0.6 |
| equipe.im | 다크 쌍 재현율 · 맞은 쌍 | 11/17 · 맞은 쌍 24/43, 역할 + 변수 ⚠︎ | 7/17 · 맞은 쌍 9/24, Figma 변수 기준 | 쌍 없음 | ≥ 15/17 |
| equipe.im | 색 적중 (페이지에 쓰인 정답 색) | 21/21 (다크 inverse-accent 누락) ⚠︎ | 21/21 | 21/21 | 21/21 + 다크 짝 전부 |
| equipe.im | 타이포 | 글꼴 2/2 (+2) | 글꼴 2/2 (+2) | 글꼴 2/2 | 2/2 |
| equipe.im | 브랜드색 | ✓ `#1d4ed8` | ✓ `#1d4ed8` | ✓ `#1d4ed8` | ✓ |
| ui.shadcn.com | 다크 변수·역할 값 | ✗ 6/11 (--foreground #a1a1a1, --card #262626) ⚠︎ | ✗ 0/11 (라이트=다크 10개) | ✗ 3/11 (--background #ffffff, --card 없음) | 정답 쌍 ≥ 90% |
| ui.shadcn.com | 다크 쌍 재현율 · 맞은 쌍 | 6/10 · 맞은 쌍 6/18, 역할 + 변수 ⚠︎ | 1/10 · 맞은 쌍 2/8, Figma 변수 기준 | 쌍 없음 | ≥ 90% |
| ui.shadcn.com | 색 적중 (페이지에 쓰인 정답 색) | 13/13 | 13/13 (다크 background·secondary·muted 누락) | 12/13 (누락 destructive) |  |
| ui.shadcn.com | 반경 재현율 · 정밀도 | 4/4 · 4/9 ⚠︎ | 2/4 · 2/7 | 4/4 · 4/20 | ≥ 3/4 · ≥ 0.6 |
| ui.shadcn.com | 타이포 | 글꼴 1/2 | 글꼴 1/2 | 글꼴 1/2 |  |
| atlassian.design | 색 적중 (페이지에 쓰인 정답 색) | 20/20 | 20/20 | 20/20 |  |
| atlassian.design | 다크 쌍 재현율 · 맞은 쌍 | 16/16 · 맞은 쌍 77/484, 역할 + 변수 | 6/16 · 맞은 쌍 8/22, Figma 변수 기준 | 쌍 없음 |  |
| atlassian.design | 간격 재현율 · 정밀도 | 11/11 · 11/13 | 0/11 · 0/6 | 8/11 · 8/11 |  |
| atlassian.design | 반경 재현율 · 정밀도 | 5/5 · 5/8 | 3/5 · 3/8 | 5/5 · 5/12 |  |
| atlassian.design | 타이포 | 글꼴 3/3 · 크기 5/7 | 글꼴 3/3 · 크기 7/7 | 글꼴 2/3 · 크기 6/7 |  |
| atlassian.design | 브랜드색 | △ uncertain, 1위 `#1868db` ⚠︎ | ✓ `#1868db` | ✓ `#1868db` | ✓ |
| carbondesignsystem.com | 색 적중 (페이지에 쓰인 정답 색) | 18/18 | 18/18 | 18/18 |  |
| carbondesignsystem.com | 간격 재현율 · 정밀도 | 9/9 · 9/15 | 2/9 · 2/6 | 9/9 · 9/18 |  |
| carbondesignsystem.com | 타이포 | 글꼴 2/2 · 크기 3/7 | 글꼴 2/2 · 크기 4/7 | 글꼴 2/2 · 크기 3/7 |  |
| carbondesignsystem.com | 브랜드색 | ✓ `#0f62fe` | ✓ `#0f62fe` | ✗ `#002d9c` | ✓ |
| linear.app | 브랜드색 | ✓ `none` | ✗ `#e4f222` | △ `#d0d6e0` | ✓ none |
| linear.app | dark-only 판정 | ✓ | – (판정 없음) | – (판정 없음) | ✓ |
| raycast.com | 브랜드색 | ✓ `#ff6363` | ✗ `#ffc531` | ✓ `#ff6363` | ✓ #ff6363 |
| raycast.com | dark-only 판정 | ✓ | – (판정 없음) | – (판정 없음) | ✓ |
| (전체) | 페이지당 시간 | 7~37초 | 46~246초 | 16~150초 | ≤ 30초 |

⚠︎ = equipe-design이 목표에 못 미친 칸. 셀의 `a/b · c/d`는 재현율 · 정밀도(정밀도 분모 = 도구가 낸 단계 수).

## 실행 상태

| 사이트 | equipe-design | designlang 13.3.2 | Dembrandt 0.39.2 |
|---|---|---|---|
| equipe.im | ok 7초 | ok 98초 | ok 31초 |
| ui.shadcn.com | ok 15초 | ok 46초 | ok 16초 |
| atlassian.design | ok 18초 | ok 116초 | ok 27초 |
| carbondesignsystem.com | ok 37초 | ok 58초 | ok 27초 |
| linear.app | ok 30초 | ok 141초 | ok 26초 |
| raycast.com | ok 10초 | ok 246초 | ok 150초 |

## equipe-design 미달 항목

- equipe.im · 다크 쌍 재현율 · 맞은 쌍: 11/17 · 맞은 쌍 24/43, 역할 + 변수 (목표 ≥ 15/17)
- equipe.im · 색 적중 (페이지에 쓰인 정답 색): 21/21 (다크 inverse-accent 누락) (목표 21/21 + 다크 짝 전부)
- ui.shadcn.com · 다크 변수·역할 값: ✗ 6/11 (--foreground #a1a1a1, --card #262626) (목표 정답 쌍 ≥ 90%)
- ui.shadcn.com · 다크 쌍 재현율 · 맞은 쌍: 6/10 · 맞은 쌍 6/18, 역할 + 변수 (목표 ≥ 90%)
- ui.shadcn.com · 반경 재현율 · 정밀도: 4/4 · 4/9 (목표 ≥ 3/4 · ≥ 0.6)
- atlassian.design · 브랜드색: △ uncertain, 1위 `#1868db` (목표 ✓)
- carbondesignsystem.com · 시간: 37초 (목표 ≤ 30초)

## 정답 출처

- **equipe.im** — checkedAt 2026-11-02. [equipe design tokens (generated CSS)](https://github.com/equipe-labs/equipe/blob/main/design/build/css/tokens.css), [T-257 03 equipe.im 정답 대조](outputs/T-257 추출 엔진 비교/03 equipe.im 정답 대조.md)
- **ui.shadcn.com** — checkedAt 2026-11-02. [ui.shadcn.com site stylesheet (:root and .dark, Next.js CSS chunk)](https://ui.shadcn.com/), [shadcn Theming docs](https://ui.shadcn.com/docs/theming)
- **atlassian.design** — checkedAt 2026-11-02. [@atlaskit/tokens 20.9.0 light theme](https://unpkg.com/@atlaskit/tokens@20.9.0/dist/esm/artifacts/themes/atlassian-light.js), [@atlaskit/tokens 20.9.0 dark theme](https://unpkg.com/@atlaskit/tokens@20.9.0/dist/esm/artifacts/themes/atlassian-dark.js), [@atlaskit/tokens 20.9.0 spacing](https://unpkg.com/@atlaskit/tokens@20.9.0/dist/esm/artifacts/themes/atlassian-spacing.js), [@atlaskit/tokens 20.9.0 shape](https://unpkg.com/@atlaskit/tokens@20.9.0/dist/esm/artifacts/themes/atlassian-shape.js), [home page HTML (inline <style data-theme=...> token blocks)](https://atlassian.design/)
- **carbondesignsystem.com** — checkedAt 2026-11-02. [@carbon/themes 11.84.0 g10 theme](https://unpkg.com/@carbon/themes@11.84.0/js/generated/themes/g10.js), [@carbon/themes 11.84.0 button component tokens](https://unpkg.com/@carbon/themes@11.84.0/js/generated/component-tokens/button.js), [@carbon/layout 11.62.0 spacing](https://unpkg.com/@carbon/layout@11.62.0/scss/generated/_spacing.scss), [@carbon/type 11.70.0](https://unpkg.com/@carbon/type@11.70.0/es/index.js), [site CSS (:root g10 token block)](https://s3.us-south.cloud-object-storage.appdomain.cloud/cxp-prod-payload-cms/_next/static/css/dee0f854470ec1de.css)
- **linear.app** — checkedAt 2026-11-02. [T-218 landing research notes](outputs/T-218 랜딩 리서치/sites/linear/notes.md), [T-257 README (answers)](outputs/T-257 추출 엔진 비교/README.md)
- **raycast.com** — checkedAt 2026-11-02. [T-218 landing research notes](outputs/T-218 랜딩 리서치/sites/raycast/notes.md), [T-257 README (answers)](outputs/T-257 추출 엔진 비교/README.md)
