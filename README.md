# Loom

하루를 세로 시간축 위에 블록으로 배치해 보는 개인용 하루 계획 앱입니다. 알림이 없고, 인터넷 연결 없이 완전히 오프라인으로 동작하며, 모든 데이터는 이 기기에만 저장됩니다. iPhone 세로 화면 전용으로 설계되었습니다.

빌드 도구나 서버가 필요하지 않습니다. 이 폴더를 그대로 GitHub Pages에 올리면 `https://jennie-verse.github.io/loom/`에서 실행됩니다.

## 사용

- 시간축을 탭하거나 드래그해 블록을 만들고, 블록을 눌러 수정합니다.
- 템플릿(Weekday/Weekend)으로 하루를 빠르게 채울 수 있습니다.
- 데이터는 이 브라우저의 IndexedDB에 저장됩니다. Settings → Export JSON으로 정기적으로 백업하세요.

자세한 파일 구조와 자주 바꾸는 위치는 [구조와 바꾸는 법](docs/README-KO.md), 백업·복원은 [백업·복원 안내](docs/BACKUP-RESTORE-KO.md)를 보세요.

## 구성

`src/` 앱 코드(store·model·day-view·agenda-view 등) · `assets/` 스타일과 로컬 글꼴 · `icons/` PWA 아이콘 · `docs/` 한국어 안내 · `manifest.webmanifest` · `sw.js` · `.nojekyll`
