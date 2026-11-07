# equipe-design 정확도 평가 — 2026-11-08 (equipe.im만)

T-509: 다크 쌍 분모를 페이지에 있는 쌍으로 바꾼 뒤 equipe.im만 세 도구로 다시 돌림(실측 출력은 남기지 않음). 다른 사이트 정답엔 `pairOnPage` 표시가 없어 점수가 그대로라 2026-11-03 표를 따름. 정답: `eval/answers/<host>.json`. 지표 정의: 설계 README 5.2, 이 폴더의 `eval/README.md`.

| 사이트 | 지표 | equipe-design | designlang 13.3.2 | Dembrandt 0.39.2 | 목표 |
|---|---|---|---|---|---|
| equipe.im | 간격 재현율 · 정밀도 | 9/9 · 9/9 | 3/9 · 3/24 | 9/9 · 9/20 | 9/9 · ≥ 0.75 |
| equipe.im | 반경 재현율 · 정밀도 | 4/5 · 4/6 | 1/5 · 1/10 | 4/5 · 4/15 | ≥ 4/5 · ≥ 0.6 |
| equipe.im | 다크 쌍 재현율 · 맞은 쌍 | 11/11 (페이지 밖 6쌍 제외) · 맞은 쌍 24/43, 역할 + 변수 | 7/11 (페이지 밖 6쌍 제외) · 맞은 쌍 9/24, Figma 변수 기준 | 쌍 없음 | ≥ 88% (페이지 쌍) |
| equipe.im | 색 적중 (페이지에 쓰인 정답 색) | 21/21 | 21/21 | 21/21 | 21/21 + 페이지의 다크 짝 전부 |
| equipe.im | 타이포 | 글꼴 2/2 (+2) | 글꼴 2/2 (+2) | 글꼴 2/2 | 2/2 |
| equipe.im | 브랜드색 | ✓ `#1d4ed8` | ✓ `#1d4ed8` | ✓ `#1d4ed8` | ✓ |
| (전체) | 페이지당 시간 | 19초 | 117초 | 77초 | ≤ 30초 |

⚠︎ = equipe-design이 목표에 못 미친 칸. 셀의 `a/b · c/d`는 재현율 · 정밀도(정밀도 분모 = 도구가 낸 단계 수).

## 실행 상태

| 사이트 | equipe-design | designlang 13.3.2 | Dembrandt 0.39.2 |
|---|---|---|---|
| equipe.im | ok 19초 | ok 117초 | ok 77초 |

## equipe-design 미달 항목

- 없음 (목표가 있는 칸 기준)

## 정답 출처

- **equipe.im** — checkedAt 2026-11-02. [equipe design tokens (generated CSS)](https://github.com/equipe-labs/equipe/blob/main/design/build/css/tokens.css), [T-257 03 equipe.im 정답 대조](outputs/T-257 추출 엔진 비교/03 equipe.im 정답 대조.md)
