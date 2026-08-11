# GitHub Pages 배포 안내

1. authoritative source인 `WebApp/Published/loom/`에서 수정·테스트·commit·push합니다.
2. 저장소 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 둡니다.
3. `.github/workflows/deploy.yml`이 `npm ci && npm test`를 통과한 뒤 runtime allowlist만 Pages에 올립니다.
4. workflow가 성공하면 `https://jennie-verse.github.io/loom/`을 열어 화면과 Service Worker version을 확인합니다.
5. 로컬 `WebApp/Deliverable/loom/`은 성공한 artifact의 읽기 전용 snapshot으로 갱신합니다.

배포 allowlist에는 `.nojekyll`, `README.md`, `index.html`, manifest, `sw.js`, `assets/`, `docs/`, `icons/`, `licenses/`, `src/`만 포함합니다. `tests/`, `package*.json`, `.github/`, `node_modules/`는 배포하지 않습니다.

모든 코드 경로가 `./` 상대 경로이므로 저장소 이름이 `loom`이면 `/loom/` 하위 경로에서 그대로 동작합니다. 저장소 이름을 바꾸면 경로도 그에 맞게 바뀝니다.

## 업데이트할 때

1. 수정한 파일을 commit해 `main`에 push합니다.
2. `sw.js`를 고쳤다면 맨 위 `CACHE_NAME`의 숫자를 반드시 올립니다 (예: `loom-v1` → `loom-v2`). 올리지 않으면 사용자 기기에 옛 버전이 그대로 캐시되어 남습니다.
3. `APP_SHELL` 목록에 새 파일을 추가했거나 파일 이름을 바꿨다면 목록도 함께 고칩니다.
4. Actions의 test와 Pages deployment가 모두 성공했는지 확인합니다.
5. 사용자가 앱을 다시 열면 `New version available` 토스트가 뜨고, `Reload`를 눌러야 새 버전이 적용됩니다 (작성 중인 내용을 보호하기 위해 자동으로 새로고침하지 않습니다).

## 배포 전 확인

- 저장소 최상위에 `index.html`, `.nojekyll`, `sw.js`, `manifest.webmanifest`가 있는지 확인합니다.
- Pages 주소를 열고 브라우저 개발자 도구에서 콘솔 오류와 404 요청이 0건인지 확인합니다.
- 블록을 하나 만들고 새로고침해도 남아 있는지 확인합니다.
- 한 번 온라인으로 연 뒤 기기를 비행기 모드로 바꾸고 다시 열어 오프라인에서 동작하는지 확인합니다.
- 실제 iPhone에서 홈 화면 설치, 아이콘 모양, standalone(주소창 없이) 실행을 확인합니다.

배포 주소가 실제로 열리는 것을 확인한 뒤에만 이 폴더를 `Published/loom/`으로 옮기세요.
