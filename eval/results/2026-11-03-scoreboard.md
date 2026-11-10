# equipe-design 정확도 평가 — 2026-11-03

실행 폴더: `eval/out/2026-11-03` (T-343 엔진 수정 뒤, 실측 출력은 디스크 때문에 지움). 정답: `eval/answers/<host>.json`. 지표 정의: 설계 README 5.2, 이 폴더의 `eval/README.md`.

| 사이트 | 지표 | equipe-design | designlang 13.3.2 | Dembrandt 0.39.2 | 목표 |
|---|---|---|---|---|---|
| equipe.im | 간격 재현율 · 정밀도 | 9/9 · 9/9 | 3/9 · 3/24 | 9/9 · 9/20 | 9/9 · ≥ 0.75 |
| equipe.im | 반경 재현율 · 정밀도 | 4/5 · 4/6 | 1/5 · 1/10 | 4/5 · 4/15 | ≥ 4/5 · ≥ 0.6 |
| equipe.im | 다크 쌍 재현율 · 맞은 쌍 | 11/17 · 맞은 쌍 24/43, 역할 + 변수 ⚠︎ | 7/17 · 맞은 쌍 9/24, Figma 변수 기준 | 쌍 없음 | ≥ 15/17 |
| equipe.im | 색 적중 (페이지에 쓰인 정답 색) | 21/21 (다크 inverse-accent 누락) ⚠︎ | 21/21 | 21/21 | 21/21 + 다크 짝 전부 |
| equipe.im | 타이포 | 글꼴 2/2 (+2) | 글꼴 2/2 (+2) | 글꼴 2/2 | 2/2 |
| equipe.im | 브랜드색 | ✓ `#1d4ed8` | ✓ `#1d4ed8` | ✓ `#1d4ed8` | ✓ |
| ui.shadcn.com | 다크 변수·역할 값 | ✓ 11/11 | ✗ 0/11 (라이트=다크 10개) | ✗ 3/11 (--background #ffffff, --card 없음) | 정답 쌍 ≥ 90% |
| ui.shadcn.com | 다크 쌍 재현율 · 맞은 쌍 | 10/10 · 맞은 쌍 49/250, 역할 + 변수 | 1/10 · 맞은 쌍 2/8, Figma 변수 기준 | 쌍 없음 | ≥ 90% |
| ui.shadcn.com | 색 적중 (페이지에 쓰인 정답 색) | 13/13 | 13/13 (다크 background·secondary·muted 누락) | 12/13 (누락 destructive) |  |
| ui.shadcn.com | 반경 재현율 · 정밀도 | 4/4 · 4/6 | 2/4 · 2/7 | 4/4 · 4/20 | ≥ 3/4 · ≥ 0.6 |
| ui.shadcn.com | 타이포 | 글꼴 1/2 | 글꼴 1/2 | 글꼴 1/2 |  |
| atlassian.design | 색 적중 (페이지에 쓰인 정답 색) | 20/20 | 20/20 | 20/20 |  |
| atlassian.design | 다크 쌍 재현율 · 맞은 쌍 | 16/16 · 맞은 쌍 78/486, 역할 + 변수 | 6/16 · 맞은 쌍 9/22, Figma 변수 기준 | 쌍 없음 |  |
| atlassian.design | 간격 재현율 · 정밀도 | 11/11 · 11/13 | 1/11 · 1/7 | 8/11 · 8/11 |  |
| atlassian.design | 반경 재현율 · 정밀도 | 5/5 · 5/7 | 3/5 · 3/8 | 5/5 · 5/12 |  |
| atlassian.design | 타이포 | 글꼴 3/3 · 크기 5/7 | 글꼴 3/3 · 크기 7/7 | 글꼴 2/3 · 크기 6/7 |  |
| atlassian.design | 브랜드색 | ✓ `#1868db` | ✓ `#1868db` | ✓ `#1868db` | ✓ |
| carbondesignsystem.com | 색 적중 (페이지에 쓰인 정답 색) | 18/18 | 18/18 | 18/18 |  |
| carbondesignsystem.com | 간격 재현율 · 정밀도 | 9/9 · 9/15 | 2/9 · 2/6 | 9/9 · 9/18 |  |
| carbondesignsystem.com | 타이포 | 글꼴 2/2 · 크기 3/7 | 글꼴 2/2 · 크기 4/7 | 글꼴 2/2 · 크기 3/7 |  |
| carbondesignsystem.com | 브랜드색 | ✓ `#0f62fe` | ✓ `#0f62fe` | ✗ `#002d9c` | ✓ |
| linear.app | 브랜드색 | ✓ `none` | ✗ `#e4f222` | △ `#d0d6e0` | ✓ none |
| linear.app | dark-only 판정 | ✓ | – (판정 없음) | – (판정 없음) | ✓ |
| raycast.com | 브랜드색 | ✓ `#ff6363` | ✗ `#ffc531` | ✓ `#ff6363` | ✓ #ff6363 |
| raycast.com | dark-only 판정 | ✓ | – (판정 없음) | – (판정 없음) | ✓ |
| (전체) | 페이지당 시간 | 6~30초 | 30~240초 | 19~133초 | ≤ 30초 |

⚠︎ = equipe-design이 목표에 못 미친 칸. 셀의 `a/b · c/d`는 재현율 · 정밀도(정밀도 분모 = 도구가 낸 단계 수).

## 실행 상태

| 사이트 | equipe-design | designlang 13.3.2 | Dembrandt 0.39.2 |
|---|---|---|---|
| equipe.im | ok 12초 | ok 102초 | ok 28초 |
| ui.shadcn.com | ok 6초 | ok 41초 | ok 19초 |
| atlassian.design | ok 22초 | ok 104초 | ok 30초 |
| carbondesignsystem.com | ok 21초 | ok 30초 | ok 24초 |
| linear.app | ok 30초 | ok 147초 | ok 28초 |
| raycast.com | ok 9초 | ok 240초 | ok 133초 |

## equipe-design 미달 항목

- equipe.im · 다크 쌍 재현율 · 맞은 쌍: 11/17 · 맞은 쌍 24/43, 역할 + 변수 (목표 ≥ 15/17)
- equipe.im · 색 적중 (페이지에 쓰인 정답 색): 21/21 (다크 inverse-accent 누락) (목표 21/21 + 다크 짝 전부)

## T-343: 2026-11-02 미달 7건

| # | 항목 | 11-02 | 11-03 | 원인과 고친 것 |
|---|---|---|---|---|
| 1 | equipe.im 다크 쌍 | 11/17 | 11/17 ⚠︎ | **못 맞춤.** 못 찾은 6쌍(raised, err, on-err, inverse-accent, action-hover, action-pressed)은 지금 equipe.im 페이지의 CSS에도, 브라우저가 라이트·다크로 그린 1452개 요소에도 없음(2026-11-03 확인). 정답이 tokens.css 전체에서 왔고 사이트는 그중 일부만 씀. 페이지에 있는 11쌍은 모두 찾음 |
| 2 | equipe.im 다크 inverse-accent | 누락 | 누락 ⚠︎ | **못 맞춤.** 1과 같은 이유: 다크 화면 어디에도 `#1d4ed8`(inverse-accent의 다크 값)이 그려지지 않음. 라이트 값 `#8fb0ff`가 '쓰임'으로 잡힌 건 --accent의 다크 값과 같은 색이라서 |
| 3 | shadcn 다크 값 | 6/11 | 11/11 | 채점기 버그. 엔진은 맞는 색을 냈지만(`resolvesTo`), 채점기가 변수의 선언 텍스트(`lab(98.26% 0 0)`)를 hex로 못 읽어 역할 값으로 대신 채점함. 이제 변수가 실제로 풀린 관찰 색으로 채점 |
| 4 | shadcn 다크 쌍 | 6/10 | 10/10 | 3과 같은 원인 |
| 5 | shadcn 반경 정밀도 | 4/9 | 4/6 | 반경 변수 묶음이 있고 그중 3단계 이상을 요소가 쓰면 그 묶음을 단계로 삼음(간격과 같은 규칙). 프레임워크가 선언만 하고 페이지가 안 쓰는 크기(2, 26px)와 묶음 밖 값(24px)은 단계에서 빠지고 이상값으로 남음 |
| 6 | atlassian 브랜드색 | △ | ✓ | ① `accent-lime`·`accent-purple`처럼 색상 이름이 붙은 accent는 범주 팔레트라 강한 변수 이름에서 뺌 ② 버튼·링크 안의 아이콘(SVG) 채움은 상호작용의 절반만 셈 ③ 링크·버튼 자체를 칠하는 색이 `brand` 이름 변수이면 가산. linear(브랜드 none)는 그대로 none |
| 7 | carbon 시간 | 37초 | 21초 | ① 페이지 열기: networkidle(분석·동의 스크립트·애니메이션으로 안 옴)을 10초 기다리던 것을, 요소 추가·삭제가 1초 멈추고 글꼴이 다 오면 끝내게 함(최대 10초 그대로) ② 다크 토글이 실패할 때마다 페이지를 새로 불러오던 것을 `<html>`·`<body>` 클래스·속성만 제자리 복원으로 바꿈(같은 이유로 좁은 폭·상태 단계의 새로고침도 없앰). 단독 실행 13초 |

그 밖에 고친 것: 토글을 켜면 엔진이 `color-scheme: dark`를 걸어 `<html>`의 기본 글자색만 바뀌어도 '다크 화면'으로 잘못 판정하던 것(작은 페이지에서) — 비교에서 `<html>`을 뺌.

시간은 경쟁 도구와 같은 실행 안에서 잰 값이라 단독 실행보다 길다(linear 30초, 단독 13~26초). 목표 칸(≤ 30초)은 넘지 않았지만 linear는 경계에 있다.

## 정답 출처

- **equipe.im** — checkedAt 2026-11-02. [equipe design tokens (generated CSS)](https://github.com/equipe-labs/equipe/blob/main/design/build/css/tokens.css), [T-257 03 equipe.im 정답 대조](outputs/T-257 추출 엔진 비교/03 equipe.im 정답 대조.md)
- **ui.shadcn.com** — checkedAt 2026-11-02. [ui.shadcn.com site stylesheet (:root and .dark, Next.js CSS chunk)](https://ui.shadcn.com/), [shadcn Theming docs](https://ui.shadcn.com/docs/theming)
- **atlassian.design** — checkedAt 2026-11-02. [@atlaskit/tokens 20.9.0 light theme](https://unpkg.com/@atlaskit/tokens@20.9.0/dist/esm/artifacts/themes/atlassian-light.js), [@atlaskit/tokens 20.9.0 dark theme](https://unpkg.com/@atlaskit/tokens@20.9.0/dist/esm/artifacts/themes/atlassian-dark.js), [@atlaskit/tokens 20.9.0 spacing](https://unpkg.com/@atlaskit/tokens@20.9.0/dist/esm/artifacts/themes/atlassian-spacing.js), [@atlaskit/tokens 20.9.0 shape](https://unpkg.com/@atlaskit/tokens@20.9.0/dist/esm/artifacts/themes/atlassian-shape.js), [home page HTML (inline <style data-theme=...> token blocks)](https://atlassian.design/)
- **carbondesignsystem.com** — checkedAt 2026-11-02. [@carbon/themes 11.84.0 g10 theme](https://unpkg.com/@carbon/themes@11.84.0/js/generated/themes/g10.js), [@carbon/themes 11.84.0 button component tokens](https://unpkg.com/@carbon/themes@11.84.0/js/generated/component-tokens/button.js), [@carbon/layout 11.62.0 spacing](https://unpkg.com/@carbon/layout@11.62.0/scss/generated/_spacing.scss), [@carbon/type 11.70.0](https://unpkg.com/@carbon/type@11.70.0/es/index.js), [site CSS (:root g10 token block)](https://s3.us-south.cloud-object-storage.appdomain.cloud/cxp-prod-payload-cms/_next/static/css/dee0f854470ec1de.css)
- **linear.app** — checkedAt 2026-11-02. [T-218 landing research notes](outputs/T-218 랜딩 리서치/sites/linear/notes.md), [T-257 README (answers)](outputs/T-257 추출 엔진 비교/README.md)
- **raycast.com** — checkedAt 2026-11-02. [T-218 landing research notes](outputs/T-218 랜딩 리서치/sites/raycast/notes.md), [T-257 README (answers)](outputs/T-257 추출 엔진 비교/README.md)
