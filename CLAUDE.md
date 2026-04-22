# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 명령어

```bash
npm run dev        # 개발 서버 실행 (Vite HMR)
npm run build      # 프로덕션 빌드
npm run preview    # 빌드 결과 로컬 미리보기
npm run lint       # ESLint 검사 (--fix 미포함)
```

테스트 러너와 CI/CD 파이프라인은 없다.

## 아키텍처

**단일 페이지 React + Vite 앱**으로, 거의 모든 로직이 `src/App.jsx` (~1,800줄) 한 파일에 집중되어 있다. 라우팅 라이브러리는 없으며 화면 전환은 `activeTab` 상태값으로 제어한다. 전역 상태 관리 라이브러리도 없으며 모든 상태는 `App` 컴포넌트 내부의 `useState` / `useEffect`로 관리한다.

### 파일 구조

| 경로 | 역할 |
|---|---|
| `src/App.jsx` | 앱 전체: Firebase 초기화, 가격 로직, 모든 컴포넌트, 모든 상태 |
| `src/main.jsx` | React 19 `createRoot` 진입점 |
| `src/index.css` | Tailwind 지시어만 포함 |
| `public/` | 정적 에셋 (아이콘, 히어로 이미지) |

### App.jsx 내부 구조 (라인 순서)

1. **공휴일 & 가격 로직** (상단) — `DEFAULT_RATE_CONFIG`, `isWeekendPriceFn`, `getPricePerNightFn`, `fetchHolidaysFromAPI`, `refreshHolidaysIfNeeded`
2. **상수** — `ROOMS` (Shell / Beach / Pine, Tailwind 색상 포함), `PATHS` (7가지 예약 경로), `INITIAL_DATA` (시드용 예약 데이터 69건)
3. **Firebase 초기화** — `firebaseConfig`, 익명 인증, Firestore `db` export
4. **유틸리티 함수** — `formatPhone`, `getLocalTodayStr`, `addDays`
5. **`SettingsTab` 컴포넌트** — 요금 및 공휴일 관리 전용 독립 컴포넌트
6. **`App` 컴포넌트** — 캘린더, 목록, 예약 추가 폼, 검색, 통계, 모달 등 나머지 UI 전체

### Firebase / Firestore

익명 인증을 사용한다. Firestore 컬렉션 구성:

| 컬렉션 | 주요 문서 / 필드 |
|---|---|
| `reservations` | 예약 1건당 1문서: `date`, `room`, `name`, `phone`, `path`, `nights`, `price`, `adults`, `kids`, `bbq`, `memo`, `createdAt` |
| `config` | `rateConfig` (요금 규칙, 시즌, 공휴일), `blockDates` (날짜별 객실 차단 맵), `holidayMeta` (공휴일 갱신 타임스탬프) |

Firebase 자격증명과 한국 공휴일 API 키는 모두 `App.jsx`에 **하드코딩**되어 있다. `.env` 파일은 존재하지 않는다.

### 인증

하드코딩된 PIN (`"9631"`) 방식의 잠금 화면이 유일한 접근 제어다. 별도 백엔드 없이 브라우저에서 Firestore에 직접 통신한다.

### 가격 계산 로직

`getPricePerNightFn(dateStr, room, rateConfig)`는 **한국 공휴일 → 주말 여부 → 시즌 날짜 범위** 순서로 확인해 1박 요금을 반환한다. 모든 조정 파라미터는 Firestore `config/rateConfig`에 저장된 `rateConfig` 객체에서 가져온다. `fetchHolidaysFromAPI`는 공공데이터포털 API를 호출하며, `refreshHolidaysIfNeeded`가 당해 연도와 다음 연도의 공휴일을 하루 1회 자동 갱신한다.

### UI 규칙

- 스타일은 **Tailwind CSS 유틸리티 클래스만** 사용한다. CSS 모듈, styled-components 없음.
- 아이콘은 `lucide-react`, 차트는 `recharts`를 사용한다.
- 컴포넌트 라이브러리(shadcn, MUI 등) 없이 JSX로 직접 구현되어 있다.
- 캘린더, 목록, 통계, 예약 추가 폼은 별도 파일이나 컴포넌트가 아닌 `App` 내부에 인라인으로 렌더링된다.
- `activeTab` 유효값: `'calendar'`, `'list'`, `'add'`, `'search'`, `'stats'`, `'settings'`

### ESLint

새 flat-config 형식(`eslint.config.js`)을 사용한다. `react-hooks/exhaustive-deps`와 `react-refresh/only-export-components`가 활성화되어 있다. `no-unused-vars`는 `/^[A-Z_]/` 패턴(대문자 상수)을 허용한다.
