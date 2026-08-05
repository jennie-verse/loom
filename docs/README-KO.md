# Loom — 무엇인지, 파일 구조, 바꾸는 법

## 무엇인지

Loom은 하루를 세로 시간축 위에 블록으로 배치해 보는 개인용 하루 계획 앱입니다. 알림이 없고, 인터넷 연결 없이 완전히 오프라인으로 동작하며, 모든 데이터는 이 기기에만 저장됩니다. iPhone 세로 화면 전용으로 설계되었습니다.

저장소·배포 주소: `github.com/jennie-verse/loom` → `https://jennie-verse.github.io/loom/`

## 파일 구조

```text
loom/
├─ .nojekyll                  GitHub Pages가 Jekyll로 처리하지 않도록 하는 표시 파일
├─ index.html                 앱 셸 (헤더, 화면 골격)
├─ manifest.webmanifest       PWA 설치 정보
├─ sw.js                      Service Worker — 오프라인 캐시
├─ assets/
│  ├─ app.css                 전체 디자인 토큰과 스타일
│  └─ fonts/                  Lexend 400·700 (오프라인 동봉)
├─ src/
│  ├─ store.js                IndexedDB 저장, localStorage 설정
│  ├─ model.js                데이터 검증, 겹침 계산, 표시 단계 판정
│  ├─ day-view.js             하루 시간축 화면 · 드래그 · 현재 시각 선
│  ├─ agenda-view.js           목록 화면
│  ├─ block-sheet.js          블록 만들기·수정 시트
│  ├─ calendar-sheet.js       날짜 선택 달력
│  ├─ templates.js            템플릿
│  ├─ backup.js                내보내기·가져오기
│  ├─ settings.js             설정 화면
│  ├─ ui.js                   토스트 · Undo · 확인창
│  └─ app.js                  화면 전체를 연결하는 진입점
├─ icons/                     앱 아이콘 (원본 SVG + PNG 3종)
├─ licenses/Lexend-OFL.txt    Lexend 폰트 라이선스
└─ docs/                      이 문서들
```

`src/app.js`는 계획서·지시서의 파일 목록에는 없지만, 위 모듈들을 하나의 화면으로 연결하는 진입점이 필요해 추가했습니다 (grove, atlas의 `app.js`와 같은 역할). `index.html`이 이 파일 하나만 `<script type="module">`로 불러오고, 나머지는 전부 `import`로 연결됩니다. 번들러나 빌드 도구는 쓰지 않습니다.

## 자주 바꾸는 위치

| 바꾸고 싶은 것 | 위치 |
|---|---|
| 앱 이름 | `index.html`의 `<title>`, `manifest.webmanifest`의 `name`/`short_name` |
| 대표색·블록 6색 | `assets/app.css` 맨 위 `:root` 안의 `--accent`, `--c-*`, `--t-*` 변수 |
| 기본 글꼴 크기·시간 간격 | `src/model.js`의 `DEFAULT_SETTINGS` |
| 아이콘 | `icons/` 폴더 (다시 그릴 때는 `Plan/loom_design-concepts/loom-icon/` 원본 참고) |
| 기본 템플릿 이름(Weekday/Weekend) | `src/store.js`의 `DEFAULT_TEMPLATES` |

색을 바꿀 때는 `webapp-standard.md`의 "한 화면에 6색 이내" 원칙과, 블록 배경 틴트가 옅어 왼쪽 색 바 + 테두리로 경계를 만든다는 점(build brief §0-2)을 함께 고려하세요.

## 데이터가 저장되는 곳

- 블록·템플릿: 이 브라우저의 IndexedDB (`loom-db`)
- 글자 크기·시간 간격 등 설정: 이 브라우저의 localStorage (`loom.settings.v1`)

기기를 바꾸거나 브라우저 저장소가 지워지면 데이터가 사라집니다. 정기적으로 Settings → Export JSON으로 백업하세요. 자세한 내용은 [백업·복원 안내](BACKUP-RESTORE-KO.md)를 확인하세요.
