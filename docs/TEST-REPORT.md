# Loom 테스트 리포트

검토일: 2026-08-05
검토 방법: `python3 -m http.server 8080 --directory Deliverable/` 로 `http://localhost:8080/loom/`를 열어 GitHub Pages `/loom/` 하위 경로를 재현. 자동화 브라우저(데스크톱, 마우스/JS 이벤트 기반)로 기능을 검증하고, 정적 검사는 `grep`으로 실행. 실제 iPhone 터치·회전·IME는 이 환경에서 검증할 수 없어 Pending으로 분리했습니다.

---

## 고친 문제

자체 검토 중 실제로 발견해 고친 문제들입니다.

1. **빈 시간대 탭이 씹힘** — 블록을 담는 `.lanes` 레이어가 투명하지만 자기 영역 전체의 클릭을 가로채서, 블록이 없는 빈 시간대를 탭해도 새 블록 시트가 열리지 않았습니다. `.lanes`에 `pointer-events:none`, 블록·+N 칩 같은 실제 자식에는 `pointer-events:auto`를 줘서 고쳤습니다.
2. **같은 이유로 빈 날 안내 문구도 탭을 가로챔** — `.empty-hint`도 같은 방식으로 고쳤습니다.
3. **글자 크기 설정이 시간축에만 적용되고 헤더·Now&Next·하단 바·시트에는 반영 안 됨** — `--f` 변수를 시간축(`#grid`)에만 지정하고 있었습니다. 앱 전체를 감싸는 `#app-root`에 지정하도록 옮겨서, 6~17px 모든 단계가 화면 전체에 일관되게 적용되도록 고쳤습니다.
4. **키보드로 블록을 이동/길이 조절하면 포커스를 잃음** — `↑`/`↓`로 블록을 옮기면 다시 그려지면서 포커스가 `<body>`로 빠졌습니다. 이동 전 포커스된 블록 id를 기억해뒀다가 다시 그린 뒤 같은 id의 블록에 포커스를 돌려주도록 고쳤습니다.
5. **`innerHTML = ""` 사용이 지시서의 자동 검사에 걸림** — 사용자 입력을 넣는 곳은 원래부터 전부 `textContent`/`createElement`였지만, DOM을 비울 때 쓴 `el.innerHTML = ""` 몇 곳이 `grep -rnE 'innerHTML'` 검사에 걸렸습니다. 전부 `el.replaceChildren()`으로 바꿨습니다 (동작은 동일, 안전한 표준 API).

---

## 통과

### 정적 검사 (build brief §6 그대로 실행)

- [x] 절대 경로(`src="/`, `href="/`) 없음
- [x] 외부 URL 없음 (`https?://` 흔적이 저장소 이름 `jennie-verse` 외에는 없음)
- [x] `innerHTML` · `eval(` · `new Function` 없음
- [x] `sw.js`의 `CACHE_NAME`이 `loom-v1`로 존재
- [x] `srcdoc`, 인라인 `on*` 속성 없음
- [x] `.nojekyll` 포함, 파일·폴더 이름 전부 영문 소문자+하이픈

### PWA / 경로

- [x] `http://localhost:8080/loom/`에서 정상 로드, 콘솔 오류 0건
- [x] Service Worker가 scope `.../loom/`로 등록됨
- [x] `manifest.webmanifest` fetch 성공, 아이콘 192/512 경로 정상
- [x] Service Worker install 시 앱 셸 20개 파일이 전부 캐시됨 (`caches.open('loom-v1')`로 확인)
- [x] 페이지가 Service Worker에 의해 control됨 (`navigator.serviceWorker.controller` 존재)

### 데이터

- [x] 블록 생성 → 새로고침 후에도 유지
- [x] 블록 제목에 `<script>alert(1)</script>`, `<img onerror=...>`를 넣어도 글자 그대로 표시되고 실행되지 않음
- [x] Export 백업 JSON이 `{format:"loom-backup", version:1}` 구조로 만들어짐
- [x] Import Merge: 기존 데이터 유지 + 새 항목만 추가되는 것을 개수로 확인 (추가 1건 반영)
- [x] Import 시 형식이 다른 JSON(`not json` 텍스트)을 넣으면 "Couldn't read that file" 로 거부

### 블록 표시 (계획서 2-4 표와 대조)

- [x] 15분 블록 → Micro (제목만)
- [x] 20분 블록 → Compact (제목 + 시작 시각)
- [x] 30분 블록 → Standard (제목 + 부제목)
- [x] 45분/60분 블록 → Full/Full+ 클래스 판정 정상 (부제목·메모를 채우지 않은 테스트 블록이라 실제로 보일 내용은 없었지만 단계 클래스 자체는 model.js의 `tierOf` 계산대로 부여됨)
- [x] 4개 블록이 겹치는 상황에서 3개만 나란히 보이고 `+1` 칩이 뜸, 탭하면 4개 전부(겹침 묶음)를 보여주는 시트가 열림

### 화면 / 조작

- [x] 하단 바 Add/Agenda/More 전부 동작
- [x] Day ↔ Agenda 전환 정상, Agenda는 제목·부제목·메모 항상 전체 표시
- [x] Now & Next 스트립이 진행 중 항목·다음 항목을 정확히 표시, 오늘이 아닌 날짜에서는 같은 높이로 요약 표시
- [x] More 시트의 7개 항목(Templates·Copy from…·Save today as template·Clear today·Export·Import·Settings) 전부 열림
- [x] Settings 화면의 4개 구획(Display/Behavior/Backup/Data) 정상 렌더링, 글자 크기 6px 선택 시 즉시 전체 화면에 반영
- [x] Tab으로 블록 포커스 → `ArrowDown`으로 이동 → aria-live 영역에 "moved to …" 문장 기록 → Undo 토스트 표시, Undo 버튼으로 원복 가능
- [x] Agenda 행의 Duplicate 버튼으로 블록이 복제되고 토스트로 알림
- [x] 편집 시트에서 내용을 고친 뒤 Cancel을 누르면 "Discard changes?" 확인이 뜨고, Discard를 누르면 시트가 닫힘

---

## Pending — 실기기(iPhone)에서만 확인 가능

이 환경은 데스크톱 자동화 브라우저이며 실제 터치·회전·IME·클럭 조작이 불가능해 아래 항목은 코드 리뷰와 로직 검토까지만 마쳤고, 실기기 확인이 필요합니다. (계획서 10장 마지막 절과 동일한 목록)

- [ ] 홈 화면에 추가(Add to Home Screen) 후 standalone 실행
- [ ] 실제 손가락으로 15분 블록 드래그 이동 / 아래쪽 가장자리 드래그로 길이 조절
- [ ] 400ms 길게 누른 뒤 드래그 진입, 그 전에는 세로 스크롤이 막히지 않는지
- [ ] 드래그 중 화면 위/아래 60px 안에서 자동 스크롤
- [ ] 드래그 중 두 번째 손가락을 대면 드래그가 취소되고 핀치 확대가 되는지
- [ ] 화면 왼쪽 끝 24px에서 스와이프해도 Safari 뒤로가기와 충돌하지 않는지
- [ ] 앱을 켜둔 채 실제로 자정을 넘겼을 때 오늘 날짜로 자동 전환되는지
- [ ] iCloud Drive로 백업 파일을 저장한 뒤 다시 가져오기
- [ ] iOS `<input type="time">` 휠의 실제 동작과, 5분 단위가 아닌 값을 골랐을 때 "Rounded to HH:MM" 안내가 뜨는지
- [ ] 기기를 실수로 가로로 돌렸을 때 화면이 깨지지 않고, 화면 중앙에 있던 시각이 회전 후에도 중앙에 남는지
- [ ] iOS 설정의 글자 크기(Dynamic Type)를 키운 상태에서 레이아웃
- [ ] 한글 입력기(IME) 조합 중 Enter를 눌렀을 때 조합이 끊기며 저장되지 않는지 (`compositionstart`/`compositionend` 가드는 구현되어 있으나 실제 한글 입력기로는 미검증)
- [ ] 앱이 배경으로 갔다가 돌아왔을 때 현재 시각 선이 즉시 재계산되는지, 편집 중이던 시트 내용이 남아있는지

---

## 검토하지 않은 것

- 글자 크기 6단계 × 시간 간격 5단계 = 30조합 전체를 하나하나 스크린샷으로 대조하지는 않았습니다. 6px/12px/17px, 48px/80px/120px 조합을 표본으로 확인했고 레이아웃이 깨지지 않음을 확인했습니다.
- 실기기가 필요한 항목(위 Pending)은 배포 후 사용자가 직접 확인해야 합니다.
