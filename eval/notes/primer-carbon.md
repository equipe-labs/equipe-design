# primer.style / carbondesignsystem.com — 공개 토큰 렌더링 여부 (2026-11-02)

## carbondesignsystem.com — 예 (렌더링함)
- `https://carbondesignsystem.com/` → `https://www.carbondesignsystem.com/` 리다이렉트. Next.js + Payload CMS 사이트지만 Carbon v11 CSS를 그대로 씀.
- 근거: `:root`에 g10 테마 `--cds-*` 선언 (`--cds-background:#f4f4f4`, `--cds-text-primary:#161616`, `--cds-layer-01:#ffffff`, `--cds-focus:#0f62fe` …). 파일: https://s3.us-south.cloud-object-storage.appdomain.cloud/cxp-prod-payload-cms/_next/static/css/dee0f854470ec1de.css
- @carbon/themes 11.84.0 `g10.js`와 비교: `:root` 색 토큰 235개 전부 일치, 차이 0. `--cds-spacing-01..13`도 @carbon/layout 11.62.0과 일치.
- 렌더 확인(Playwright): body 배경 #f4f4f4, 글자 #161616, 폰트 IBM Plex Sans.
- 다크 모드 없음 (prefers-color-scheme 토큰 규칙 없음, 토글 없음, dark 에뮬레이션해도 변화 없음). 단 CTA 블록과 푸터가 `.cds--g100` 존이라 g100 색(#161616 등)이 페이지에 섞여 나옴 → 채점 시 주의.
- radius: 페이지에 둥근 모서리 없음 → 생략.
- robots.txt: `Disallow: /admin/*`만 → 홈 허용. `Content-Signal: ai-train=no, search=yes, ai-input=yes` 있음.

## primer.style — 부분적 (교체함)
- `<html data-color-mode="light" data-light-theme="light" data-dark-theme="dark">`. CSS에 @primer/primitives 기능 토큰 선언은 있음 (`--bgColor-default:#fff`/`#0d1117`, `--fgColor-default:#1f2328`, `--fgColor-accent:#0969da`, `--borderColor-default:#d1d9e0` …), 값은 @primer/primitives 11.10.0 `light.css`/`dark.css`와 일치. 파일: https://primer.style/_next/static/chunks/*.css
- 하지만 실제 홈 화면은 **Primer Brand** (`--brand-*`, `--base-color-scale-*`) 컴포넌트로 그려짐: 본문 글자 #000(`--brand-color-text-default`), 보조 #58635b, 링크 #0055d5, 아이콘 배경 #f2f5f3 등. primitives 토큰(#1f2328, #0969da)은 스킵 링크·BaseStyles 래퍼 정도에만 쓰임.
- 다크: `data-color-mode="light"` 고정, 토글 없음 → 홈에서는 라이트만 보임 (dark 에뮬레이션 시 변화 여부는 미확인).
- robots.txt: `Allow: /` → 홈 허용.
- 결론: "@primer/primitives가 홈에 렌더링된다"는 정답지를 쓸 수 없음 → **atlassian.design** 으로 교체.

## 교체: atlassian.design — 예 (렌더링함)
- 홈 HTML에 @atlaskit/tokens 테마 CSS가 `<style data-theme="light|dark|spacing|shape|typography|motion">`로 인라인됨.
- @atlaskit/tokens 20.9.0 `dist/esm/artifacts/themes/atlassian-{light,dark,spacing,shape}.js`와 비교: light 466/466, dark 466/466, spacing 38/38, shape 11/11 완전 일치.
- 다크: `html[data-color-mode=dark]` 속성. head 스크립트가 prefers-color-scheme로 설정 (dark 에뮬레이션 시 body #1f1f21 확인) + "Set website theme" 버튼.
- robots.txt: 404 → 제한 없음, 홈 허용.
- 후보 중 polaris.shopify.com 은 shopify.dev/docs/api/polaris 로 리다이렉트되고 `--p-*` 토큰이 HTML에 없어 제외. spectrum/m3/designsystem.digital.gov 는 미확인.

## 산출물
- eval/answers/carbondesignsystem.com.json
- eval/answers/atlassian.design.json
