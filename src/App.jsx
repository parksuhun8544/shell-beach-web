import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, addDoc, onSnapshot,
  serverTimestamp, deleteDoc, doc, updateDoc, getDocs, writeBatch, setDoc, getDoc
} from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  Calendar, PlusCircle, BarChart3, ChevronLeft,
  ChevronRight, BedDouble, X, Users, Wallet, Trash2,
  Search, Check, TableProperties, Lock, Phone, Settings, Download,
  Copy, AlertCircle, TrendingUp, List
} from 'lucide-react';

// --- 1. 공휴일 및 요금 로직 ---

const DEFAULT_RATE_CONFIG = {
  holidays: [
    '2026-01-01','2026-01-28','2026-01-29','2026-01-30',
    '2026-03-01','2026-03-02','2026-05-05','2026-05-25',
    '2026-06-03','2026-06-06','2026-06-08',
    '2026-08-15','2026-08-17',
    '2026-09-24','2026-09-25','2026-09-26','2026-09-28',
    '2026-10-03','2026-10-05','2026-10-09','2026-12-25',
  ],
  seasons: [
    { id:'peak',     label:'성수기',   start:'07-15', end:'08-25', Shell:140000, Beach:300000, Pine:450000, weekendSame:true },
    { id:'pre1',     label:'준성수기1', start:'07-01', end:'07-14', Shell_w:120000, Shell_wk:140000, Beach_w:220000, Beach_wk:300000, Pine_w:300000, Pine_wk:450000, beachFriSpecial:250000 },
    { id:'pre2',     label:'준성수기2', start:'05-01', end:'06-30', Shell_w:120000, Shell_wk:140000, Beach_w:220000, Beach_wk:300000, Pine_w:250000, Pine_wk:450000 },
    { id:'offpeak',  label:'비수기',    start:'01-01', end:'04-30', Shell_w:100000, Shell_wk:120000, Beach_w:180000, Beach_wk:220000, Pine_w:220000, Pine_wk:400000 },
  ],
  extra: { adult: 20000, child: 15000, bbq: 30000 },
};

const isWeekendPriceFn = (dateStr, holidaySet) => {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay();
  const nxt = new Date(d);
  nxt.setDate(d.getDate() + 1);
  const ns = `${nxt.getFullYear()}-${String(nxt.getMonth()+1).padStart(2,'0')}-${String(nxt.getDate()).padStart(2,'0')}`;
  if (dow === 6) return true;
  if (holidaySet.has(ns) && nxt.getDay() !== 6) return true;
  if (holidaySet.has(ns) && nxt.getDay() === 6) return true; // 내일이 토요일 공휴일 → 주말요금
  if (dow === 5 && holidaySet.has(dateStr)) return true;
  return false;
};

const getPricePerNightFn = (room, dateStr, rateConfig) => {
  const cfg = rateConfig || DEFAULT_RATE_CONFIG;
  const holidaySet = new Set(cfg.holidays || []);
  const [,m,d] = dateStr.split('-').map(Number);
  const mmdd = m * 100 + d;
  const dt = new Date(dateStr + 'T00:00:00');
  const isFri = dt.getDay() === 5;
  const wk = isWeekendPriceFn(dateStr, holidaySet);

  for (const s of (cfg.seasons || [])) {
    const [sm, sd] = s.start.split('-').map(Number);
    const [em, ed] = s.end.split('-').map(Number);
    const startMmdd = sm * 100 + sd;
    const endMmdd = em * 100 + ed;
    if (mmdd >= startMmdd && mmdd <= endMmdd) {
      if (s.weekendSame) return s[room];
      if (s.beachFriSpecial && room === 'Beach' && isFri) return s.beachFriSpecial;
      return wk ? s[`${room}_wk`] : s[`${room}_w`];
    }
  }
  const off = cfg.seasons?.find(s => s.id === 'offpeak');
  if (off) return wk ? off[`${room}_wk`] : off[`${room}_w`];
  return 0;
};

// --- 공공데이터포털 특일 API ---
const HOLIDAY_API_KEY = '4376d57998faa2ef18ba09c939333ce2ab30b183d552bc791b4799735b3021c3';

async function fetchHolidaysFromAPI(year) {
  const url = `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo`
    + `?solYear=${year}&numOfRows=100&ServiceKey=${HOLIDAY_API_KEY}&_type=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API 오류: ${res.status}`);
  const json = await res.json();
  const items = json?.response?.body?.items?.item;
  if (!items) return { dates: [], names: {} };
  const arr = Array.isArray(items) ? items : [items];
  const dates = [];
  const names = {};
  arr.forEach(item => {
    const s = String(item.locdate);
    const dateStr = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
    dates.push(dateStr);
    names[dateStr] = item.dateName || '';
  });
  return { dates, names };
}

// 하루 1회 + 당해·내년 2개년 자동 갱신
async function refreshHolidaysIfNeeded(db, currentRateConfig, setRateConfig, showMsg) {
  try {
    const metaRef = doc(db, 'config', 'holidayMeta');
    const metaSnap = await getDoc(metaRef);
    const now = Date.now();
    const lastUpdated = metaSnap.exists() ? (metaSnap.data().updatedAt || 0) : 0;
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

    if (now - lastUpdated < TWENTY_FOUR_HOURS) return; // 24시간 미경과 → 스킵

    const thisYear = new Date().getFullYear();
    const nextYear = thisYear + 1;

    const [r1, r2] = await Promise.all([
      fetchHolidaysFromAPI(thisYear),
      fetchHolidaysFromAPI(nextYear),
    ]);

    const freshDates = [...new Set([...r1.dates, ...r2.dates])].sort();
    const freshNames = { ...r1.names, ...r2.names };

    // 기존 holidays에서 당해·내년 제거 후 API 결과로 교체
    const otherYears = (currentRateConfig.holidays || []).filter(h =>
      !h.startsWith(String(thisYear)) && !h.startsWith(String(nextYear))
    );
    const newHolidays = [...new Set([...otherYears, ...freshDates])].sort();

    // holidayNames: 기존 타년도 보존 + 갱신분 덮어쓰기
    const prevNames = currentRateConfig.holidayNames || {};
    const otherNames = Object.fromEntries(
      Object.entries(prevNames).filter(([k]) =>
        !k.startsWith(String(thisYear)) && !k.startsWith(String(nextYear))
      )
    );
    const newNames = { ...otherNames, ...freshNames };

    const newCfg = { ...currentRateConfig, holidays: newHolidays, holidayNames: newNames };

    await setDoc(doc(db, 'config', 'rateConfig'), newCfg);
    await setDoc(metaRef, { updatedAt: now });
    setRateConfig(newCfg);

    showMsg(`공휴일 자동 갱신 완료 (${thisYear}·${nextYear}년)`, 'success');
  } catch (err) {
    // 갱신 실패해도 앱 동작에 영향 없음 — 기존 데이터 유지
    console.warn('공휴일 API 갱신 실패:', err.message);
  }
}

// --- 2. 상수 ---
const ROOMS = [
  { id:'Shell', name:'Shell (쉘)', color:'bg-rose-50 text-rose-700 border-rose-100', dot:'bg-rose-500' },
  { id:'Beach', name:'Beach (비치)', color:'bg-sky-50 text-sky-700 border-sky-100', dot:'bg-sky-500' },
  { id:'Pine', name:'Pine (파인)', color:'bg-emerald-50 text-emerald-700 border-emerald-100', dot:'bg-emerald-500' },
];
const PATHS = ['직접','네이버펜션','네이버플레이스','네이버지도','여기어때','떠나요','홈페이지'];

const INITIAL_DATA = [
  { date:'2026-01-01', room:'Shell', name:'염준돈', phone:null, path:'여기어때', nights:1, price:100000, adults:0, kids:0 },
  { date:'2026-01-01', room:'Pine', name:'손미향', phone:null, path:'떠나요', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-01-02', room:'Pine', name:'박정아', phone:'01068882804', path:'네이버펜션', nights:2, price:620000, adults:0, kids:0 },
  { date:'2026-01-03', room:'Shell', name:'이태훈', phone:null, path:'떠나요', nights:1, price:120000, adults:0, kids:0 },
  { date:'2026-01-03', room:'Beach', name:'임정아', phone:'01036780953', path:'네이버플레이스', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-01-03', room:'Pine', name:'박정아', phone:'01068882804', path:'네이버펜션', nights:1, price:400000, adults:0, kids:0 },
  { date:'2026-01-10', room:'Beach', name:'황진혁', phone:'01038890176', path:'네이버지도', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-01-10', room:'Pine', name:'정희나', phone:null, path:'여기어때', nights:1, price:400000, adults:0, kids:0 },
  { date:'2026-01-11', room:'Pine', name:'김지호', phone:'01086615843', path:'네이버지도', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-01-11', room:'Beach', name:'허소영', phone:null, path:'여기어때', nights:1, price:180000, adults:0, kids:0 },
  { date:'2026-01-16', room:'Beach', name:'류희철', phone:'01090107758', path:'네이버지도', nights:1, price:180000, adults:0, kids:0 },
  { date:'2026-01-17', room:'Shell', name:'신원균', phone:'01056345527', path:'네이버지도', nights:1, price:120000, adults:0, kids:0 },
  { date:'2026-01-17', room:'Pine', name:'민경복', phone:null, path:'떠나요', nights:1, price:400000, adults:0, kids:0 },
  { date:'2026-01-22', room:'Beach', name:'최미선', phone:null, path:'여기어때', nights:2, price:360000, adults:0, kids:0 },
  { date:'2026-01-23', room:'Beach', name:'최미선', phone:null, path:'여기어때', nights:1, price:180000, adults:0, kids:0 },
  { date:'2026-01-24', room:'Shell', name:'이지', phone:null, path:'여기어때', nights:1, price:120000, adults:0, kids:0 },
  { date:'2026-01-24', room:'Pine', name:'김현정', phone:null, path:'여기어때', nights:1, price:400000, adults:0, kids:0 },
  { date:'2026-01-24', room:'Beach', name:'이하은', phone:null, path:'여기어때', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-01-25', room:'Beach', name:'문성권', phone:null, path:'여기어때', nights:1, price:180000, adults:0, kids:0 },
  { date:'2026-01-25', room:'Shell', name:'진혜령', phone:null, path:'떠나요', nights:1, price:100000, adults:0, kids:0 },
  { date:'2026-01-31', room:'Beach', name:'김태진', phone:'01094984844', path:'홈페이지', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-01-31', room:'Pine', name:'김혜영', phone:'01041796875', path:'네이버지도', nights:1, price:400000, adults:0, kids:0 },
  { date:'2026-01-31', room:'Shell', name:'이광혁', phone:null, path:'여기어때', nights:1, price:120000, adults:0, kids:0 },
  { date:'2026-02-06', room:'Pine', name:'박세진', phone:'01027593827', path:'네이버플레이스', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-02-07', room:'Pine', name:'박진웅', phone:null, path:'떠나요', nights:1, price:400000, adults:0, kids:0 },
  { date:'2026-02-07', room:'Shell', name:'고명현', phone:null, path:'떠나요', nights:1, price:120000, adults:0, kids:0 },
  { date:'2026-02-07', room:'Beach', name:'강보미', phone:null, path:'여기어때', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-02-08', room:'Pine', name:'김성운', phone:null, path:'여기어때', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-02-14', room:'Shell', name:'김주호', phone:'01032130905', path:'네이버펜션', nights:2, price:220000, adults:0, kids:0 },
  { date:'2026-02-14', room:'Pine', name:'한행륜', phone:null, path:'여기어때', nights:1, price:400000, adults:0, kids:0 },
  { date:'2026-02-14', room:'Beach', name:'이정아', phone:null, path:'여기어때', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-02-15', room:'Pine', name:'박민수', phone:null, path:'여기어때', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-02-15', room:'Shell', name:'이수진', phone:null, path:'여기어때', nights:2, price:200000, adults:0, kids:0 },
  { date:'2026-02-15', room:'Beach', name:'최지영', phone:null, path:'여기어때', nights:1, price:180000, adults:0, kids:0 },
  { date:'2026-02-16', room:'Shell', name:'박현우', phone:null, path:'여기어때', nights:1, price:100000, adults:0, kids:0 },
  { date:'2026-02-16', room:'Beach', name:'정다운', phone:null, path:'여기어때', nights:1, price:180000, adults:0, kids:0 },
  { date:'2026-02-17', room:'Beach', name:'김민준', phone:null, path:'여기어때', nights:1, price:180000, adults:0, kids:0 },
  { date:'2026-02-18', room:'Beach', name:'이서연', phone:null, path:'여기어때', nights:1, price:180000, adults:0, kids:0 },
  { date:'2026-02-21', room:'Beach', name:'황보라', phone:null, path:'여기어때', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-02-22', room:'Pine', name:'황진혁', phone:'01038890176', path:'네이버지도', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-02-27', room:'Shell', name:'류현진', phone:null, path:'네이버펜션', nights:1, price:100000, adults:0, kids:0 },
  { date:'2026-02-28', room:'Pine', name:'김태희', phone:null, path:'여기어때', nights:1, price:400000, adults:0, kids:0 },
  { date:'2026-02-28', room:'Shell', name:'이민호', phone:null, path:'여기어때', nights:2, price:240000, adults:0, kids:0 },
  { date:'2026-02-28', room:'Beach', name:'박소연', phone:null, path:'여기어때', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-03-01', room:'Beach', name:'정호영', phone:null, path:'여기어때', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-03-01', room:'Shell', name:'김나연', phone:null, path:'여기어때', nights:1, price:120000, adults:0, kids:0 },
  { date:'2026-03-07', room:'Shell', name:'최준혁', phone:null, path:'네이버지도', nights:1, price:120000, adults:0, kids:0 },
  { date:'2026-03-07', room:'Beach', name:'이유진', phone:null, path:'네이버지도', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-03-07', room:'Pine', name:'박지수', phone:null, path:'네이버지도', nights:1, price:400000, adults:0, kids:0 },
  { date:'2026-03-14', room:'Shell', name:'김동현', phone:null, path:'여기어때', nights:1, price:120000, adults:0, kids:0 },
  { date:'2026-03-14', room:'Beach', name:'오세훈', phone:null, path:'여기어때', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-03-17', room:'Pine', name:'임진혁', phone:'01026489627', path:'떠나요', nights:2, price:440000, adults:0, kids:0 },
  { date:'2026-03-21', room:'Beach', name:'서지원', phone:null, path:'여기어때', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-03-28', room:'Beach', name:'한소희', phone:null, path:'네이버펜션', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-03-28', room:'Shell', name:'김민재', phone:null, path:'네이버펜션', nights:1, price:120000, adults:0, kids:0 },
  { date:'2026-04-02', room:'Beach', name:'최단비', phone:null, path:'직접', nights:1, price:180000, adults:0, kids:0 },
  { date:'2026-04-02', room:'Pine', name:'최단비', phone:null, path:'직접', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-04-03', room:'Pine', name:'최단비', phone:null, path:'직접', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-04-04', room:'Pine', name:'정재열', phone:null, path:'직접', nights:1, price:400000, adults:0, kids:0 },
  { date:'2026-04-04', room:'Beach', name:'김광주', phone:null, path:'직접', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-04-12', room:'Pine', name:'엄마지인', phone:null, path:'직접', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-04-13', room:'Pine', name:'엄마지인', phone:null, path:'직접', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-04-17', room:'Beach', name:'김두헌', phone:null, path:'직접', nights:1, price:180000, adults:0, kids:0 },
  { date:'2026-04-17', room:'Pine', name:'이현희', phone:null, path:'직접', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-04-18', room:'Beach', name:'이현희', phone:null, path:'직접', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-04-18', room:'Pine', name:'이현희', phone:null, path:'직접', nights:1, price:400000, adults:0, kids:0 },
  { date:'2026-04-24', room:'Beach', name:'김은영', phone:null, path:'네이버지도', nights:1, price:180000, adults:0, kids:0 },
  { date:'2026-04-25', room:'Beach', name:'김유정', phone:null, path:'여기어때', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-04-25', room:'Pine', name:'김광주', phone:null, path:'직접', nights:1, price:400000, adults:0, kids:0 },
  { date:'2026-05-01', room:'Shell', name:'김미선', phone:null, path:'여기어때', nights:1, price:120000, adults:0, kids:0 },
  { date:'2026-05-01', room:'Pine', name:'정재열', phone:null, path:'직접', nights:1, price:250000, adults:0, kids:0 },
  { date:'2026-05-02', room:'Shell', name:'박인희', phone:null, path:'여기어때', nights:1, price:140000, adults:0, kids:0 },
  { date:'2026-05-02', room:'Pine', name:'김해숙', phone:null, path:'직접', nights:1, price:450000, adults:0, kids:0 },
  { date:'2026-05-02', room:'Beach', name:'김태연', phone:null, path:'여기어때', nights:1, price:300000, adults:0, kids:0 },
  { date:'2026-05-03', room:'Beach', name:'이현자', phone:null, path:'직접', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-05-15', room:'Beach', name:'김민지', phone:null, path:'네이버펜션', nights:1, price:220000, adults:0, kids:0 },
  { date:'2026-05-16', room:'Beach', name:'이수빈', phone:null, path:'네이버지도', nights:1, price:300000, adults:0, kids:0 },
  { date:'2026-05-17', room:'Pine', name:'박준영', phone:null, path:'여기어때', nights:1, price:250000, adults:0, kids:0 },
  { date:'2026-05-23', room:'Pine', name:'최예린', phone:null, path:'여기어때', nights:1, price:450000, adults:0, kids:0 },
  { date:'2026-05-23', room:'Beach', name:'강하늘', phone:null, path:'네이버지도', nights:1, price:300000, adults:0, kids:0 },
  { date:'2026-05-24', room:'Pine', name:'정우성', phone:null, path:'여기어때', nights:1, price:450000, adults:0, kids:0 },
  { date:'2026-05-24', room:'Beach', name:'김혜수', phone:null, path:'네이버지도', nights:1, price:300000, adults:0, kids:0 },
  { date:'2026-07-13', room:'Pine', name:'이준호', phone:null, path:'네이버펜션', nights:1, price:300000, adults:0, kids:0 },
];

// --- 3. Firebase ---
const firebaseConfig = {
  apiKey:"AIzaSyBaJNGRJJJxgW6eKsvloW8dAOK3afXBke8",
  authDomain:"shell-beach-admin.firebaseapp.com",
  projectId:"shell-beach-admin",
  storageBucket:"shell-beach-admin.firebasestorage.app",
  messagingSenderId:"1056075007903",
  appId:"1:1056075007903:web:4cd35e2f64792d47d81faa"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- 4. 유틸 ---
const formatPhone = (phone) => {
  if (!phone) return '';
  const d = phone.replace(/[^0-9]/g,'');
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0,3)}-${d.slice(3)}`;
  return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7,11)}`;
};
const getLocalTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const addDays = (ds, n) => {
  const [y,m,d] = ds.split('-').map(Number);
  const dt = new Date(y, m-1, d+n);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
};

// ─────────────────────────────────────────
// 요금 설정 탭 컴포넌트 (자동적용 버튼 제거됨)
// ─────────────────────────────────────────
function SettingsTab({ rateConfig, onSave }) {
  const [cfg, setCfg] = React.useState(() => JSON.parse(JSON.stringify(rateConfig)));
  const [holidayInput, setHolidayInput] = React.useState('');
  const [dirty, setDirty] = React.useState(false);

  // rateConfig prop이 외부에서 바뀌면 (API 자동갱신) 로컬 state 동기화
  React.useEffect(() => {
    setCfg(JSON.parse(JSON.stringify(rateConfig)));
    setDirty(false);
  }, [rateConfig]);

  const update = (newCfg) => { setCfg(newCfg); setDirty(true); };

  const updateSeason = (idx, field, val) => {
    const s = JSON.parse(JSON.stringify(cfg));
    s.seasons[idx][field] = val === '' ? val : (isNaN(Number(val)) ? val : Number(val));
    update(s);
  };

  const addHoliday = () => {
    const v = holidayInput.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    if (cfg.holidays.includes(v)) { setHolidayInput(''); return; }
    const s = JSON.parse(JSON.stringify(cfg));
    s.holidays = [...s.holidays, v].sort();
    update(s);
    setHolidayInput('');
  };

  const removeHoliday = (h) => {
    const s = JSON.parse(JSON.stringify(cfg));
    s.holidays = s.holidays.filter(x => x !== h);
    update(s);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-black flex items-center gap-2" style={{color:'#0f4c5c'}}>
          <Settings size={22} style={{color:'#0d9488'}} /> 요금 설정
        </h2>
        {dirty && (
          <button onClick={() => { onSave(cfg); setDirty(false); }}
            className="px-6 py-2.5 font-black rounded-xl text-sm text-white"
            style={{background:'linear-gradient(135deg,#0d9488,#0f4c5c)', boxShadow:'0 4px 16px rgba(13,148,136,0.3)'}}>
            저장
          </button>
        )}
      </div>

      {cfg.seasons.map((s, idx) => (
        <div key={s.id} className="p-6 rounded-2xl space-y-4" style={{background:'white', boxShadow:'0 2px 16px rgba(15,76,92,0.08)'}}>
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 rounded-full text-xs font-black"
              style={{
                background: s.id==='peak' ? '#fff1f2' : s.id==='pre1'||s.id==='pre2' ? '#fffbeb' : '#f0fdfa',
                color: s.id==='peak' ? '#f43f5e' : s.id==='pre1'||s.id==='pre2' ? '#d97706' : '#0d9488'
              }}>{s.label}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {['start','end'].map(field => (
              <div key={field} className="flex flex-col">
                <label className="text-[10px] font-bold mb-1" style={{color:'#94a3b8'}}>{field==='start'?'시작':'종료'} (MM-DD)</label>
                <input value={s[field]} onChange={e => updateSeason(idx,field,e.target.value)}
                  placeholder="MM-DD" maxLength={5}
                  className="p-2.5 rounded-xl font-bold text-sm outline-none"
                  style={{background:'#f0fdfa', color:'#0f4c5c'}} />
              </div>
            ))}
          </div>
          {s.weekendSame ? (
            <div>
              <label className="text-[10px] font-bold mb-2 block" style={{color:'#94a3b8'}}>단가 (평일=주말)</label>
              <div className="grid grid-cols-3 gap-2">
                {['Shell','Beach','Pine'].map(r => (
                  <div key={r} className="flex flex-col">
                    <label className="text-[10px] font-bold mb-1" style={{color:'#64748b'}}>{r}</label>
                    <input type="number" value={s[r]} onChange={e => updateSeason(idx,r,e.target.value)}
                      className="p-2 rounded-xl font-bold text-sm text-center outline-none"
                      style={{background:'#f0fdfa', color:'#0f4c5c'}} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {['Shell','Beach','Pine'].map(r => (
                <div key={r}>
                  <label className="text-[10px] font-bold mb-1 block" style={{color:'#64748b'}}>{r}</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['_w','_wk'].map(suffix => (
                      <div key={suffix} className="flex flex-col">
                        <label className="text-[10px] mb-1" style={{color:'#94a3b8'}}>{suffix==='_w'?'평일':'주말'}</label>
                        <input type="number" value={s[r+suffix]} onChange={e => updateSeason(idx, r+suffix, e.target.value)}
                          className="p-2 rounded-xl font-bold text-sm text-center outline-none"
                          style={{background:'#f0fdfa', color:'#0f4c5c'}} />
                      </div>
                    ))}
                  </div>
                  {s.beachFriSpecial !== undefined && r === 'Beach' && (
                    <div className="mt-1 flex flex-col">
                      <label className="text-[10px] mb-1" style={{color:'#d97706'}}>Beach 금요일 특가</label>
                      <input type="number" value={s.beachFriSpecial} onChange={e => updateSeason(idx,'beachFriSpecial',e.target.value)}
                        className="p-2 rounded-xl font-bold text-sm text-center outline-none"
                        style={{background:'#fffbeb', border:'1px solid #fcd34d', color:'#92400e'}} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="p-6 rounded-2xl space-y-4" style={{background:'white', boxShadow:'0 2px 16px rgba(15,76,92,0.08)'}}>
        <h3 className="font-black" style={{color:'#0f4c5c'}}>공휴일 목록</h3>
        <div className="p-4 rounded-2xl" style={{background:'#f0fdfa', border:'1px solid #99f6e4'}}>
          <p className="text-xs font-black" style={{color:'#0d9488'}}>자동 갱신 활성화됨</p>
          <p className="text-[11px] mt-1" style={{color:'#5eead4'}}>공공데이터포털 API 기반 · 앱 로드 시 24시간 주기로 당해·내년도 자동 갱신</p>
        </div>
        <div className="flex gap-2">
          <input value={holidayInput} onChange={e => setHolidayInput(e.target.value)}
            onKeyDown={e => e.key==='Enter' && addHoliday()}
            placeholder="YYYY-MM-DD 임시공휴일 수동 추가" maxLength={10}
            className="flex-1 p-3 rounded-xl font-bold text-sm outline-none"
            style={{background:'#f0fdfa', color:'#0f4c5c'}} />
          <button onClick={addHoliday}
            className="px-4 py-3 font-black rounded-xl text-sm text-white"
            style={{background:'#0f4c5c'}}>
            추가
          </button>
        </div>
        <div className="flex flex-wrap gap-2 max-h-52 overflow-y-auto">
          {cfg.holidays.map(h => (
            <span key={h} className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold"
              style={{background:'#f0fdfa', color:'#0f4c5c'}}>
              {h}
              <button onClick={() => removeHoliday(h)} className="ml-1" style={{color:'#f43f5e'}}>×</button>
            </span>
          ))}
        </div>
      </div>

      {dirty && (
        <button onClick={() => { onSave(cfg); setDirty(false); }}
          className="w-full py-4 font-black rounded-2xl text-white"
          style={{background:'linear-gradient(135deg,#0d9488,#0f4c5c)', boxShadow:'0 4px 16px rgba(13,148,136,0.3)'}}>
          변경사항 저장
        </button>
      )}
    </div>
  );
}

export default function App() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [reservations, setReservations] = useState([]);
  const [rateConfig, setRateConfig] = useState(DEFAULT_RATE_CONFIG);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('calendar');
  const [viewDate, setViewDate] = useState(new Date());
  const [message, setMessage] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [exitConfirm, setExitConfirm] = useState(false);
  const [selectedResId, setSelectedResId] = useState(null);

  const [isManualPrice, setIsManualPrice] = useState(false);
  const [manualPrice, setManualPrice] = useState('');
  const [manualPriceMode, setManualPriceMode] = useState('total');
  const [roomTouched, setRoomTouched] = useState(false);
  const [calendarView, setCalendarView] = useState('month'); // 'month' | 'week'
  const [searchFilter, setSearchFilter] = useState('all'); // 'all' | 'nophone'
  const [formData, setFormData] = useState({
    date: getLocalTodayStr(), room:'Shell', name:'', phone:'010',
    adults:0, kids:0, bbq:false, nights:1, memo:'', path:'직접'
  });

  const showMsg = (text, type) => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (pinInput === '9631') { setIsUnlocked(true); }
    else { setPinError(true); setPinInput(''); }
  };

  useEffect(() => {
    if (!isUnlocked) return;
    let unsub = null;
    const init = async () => {
      try {
        await signInAnonymously(auth);
        const colRef = collection(db,'reservations');
        const snap = await getDocs(colRef);
        if (snap.empty) {
          const batch = writeBatch(db);
          INITIAL_DATA.forEach(data => batch.set(doc(colRef), { ...data, createdAt: serverTimestamp() }));
          await batch.commit();
        }
        // rateConfig 로드
        let loadedCfg = DEFAULT_RATE_CONFIG;
        const cfgSnap = await getDocs(collection(db,'config'));
        cfgSnap.forEach(d => { if (d.id === 'rateConfig') loadedCfg = d.data(); });
        setRateConfig(loadedCfg);

        // 공휴일 자동 갱신 (24시간 주기)
        await refreshHolidaysIfNeeded(db, loadedCfg, setRateConfig, showMsg);

        unsub = onSnapshot(collection(db,'reservations'), (s) => {
          setReservations(s.docs.map(d => ({ id:d.id, ...d.data() })));
          setLoading(false);
        }, () => setLoading(false));
      } catch { setLoading(false); }
    };
    init();
    return () => { if (unsub) unsub(); };
  }, [isUnlocked]);

  const backRef = React.useRef({ isModalOpen, activeTab, exitConfirm, loading });
  useEffect(() => { backRef.current = { isModalOpen, activeTab, exitConfirm, loading }; },
    [isModalOpen, activeTab, exitConfirm, loading]);

  useEffect(() => {
    if (!isUnlocked) return;
    window.history.pushState(null, '', window.location.href);
    const onBack = () => {
      const s = backRef.current;
      if (s.loading) { window.history.pushState(null, '', window.location.href); return; }
      if (s.isModalOpen) { resetModal(); setActiveTab('calendar'); window.history.pushState(null, '', window.location.href); return; }
      if (s.activeTab !== 'calendar') { setActiveTab('calendar'); window.history.pushState(null, '', window.location.href); return; }
      if (!s.exitConfirm) { setExitConfirm(true); setTimeout(() => setExitConfirm(false), 3000); window.history.pushState(null, '', window.location.href); return; }
      window.history.back();
    };
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, [isUnlocked]);

  const reservationMap = useMemo(() => {
    const map = {};
    reservations.forEach(res => {
      if (!res.date) return;
      for (let i = 0; i < (res.nights||1); i++) {
        const ds = addDays(res.date, i);
        if (!map[ds]) map[ds] = [];
        map[ds].push(res);
      }
    });
    return map;
  }, [reservations]);

  const isRoomFull = (roomType, dateStr, excludeId=null) =>
    reservationMap[dateStr]?.some(r => r.room === roomType && r.id !== excludeId) ?? false;

  const stats = useMemo(() => {
    let revenue = 0;
    const monthlyMap = {};
    const monthlyNights = {}; // 객실별 점유박수
    const pathMap = {}; // 경로별 매출
    reservations.forEach(r => {
      if (!r.date || !r.room || !r.nights) return;
      const totalP = Number(r.price) || 0;
      const perNight = Math.round(totalP / r.nights);
      revenue += totalP;
      // 경로별
      const path = r.path || '기타';
      if (!pathMap[path]) pathMap[path] = { revenue:0, count:0 };
      pathMap[path].revenue += totalP;
      pathMap[path].count += 1;
      for (let i = 0; i < r.nights; i++) {
        const ds = addDays(r.date, i);
        const ym = ds.slice(0, 7);
        if (!monthlyMap[ym]) monthlyMap[ym] = { Shell:0, Beach:0, Pine:0, total:0 };
        monthlyMap[ym][r.room] += perNight;
        monthlyMap[ym].total += perNight;
        if (!monthlyNights[ym]) monthlyNights[ym] = { Shell:0, Beach:0, Pine:0 };
        monthlyNights[ym][r.room] += 1;
      }
    });
    return { revenue, count:reservations.length, monthlyMap, monthlyNights, pathMap };
  }, [reservations]);

  const getPricePerNight = React.useCallback((room, dateStr) =>
    getPricePerNightFn(room, dateStr, rateConfig), [rateConfig]);

  const calcStayPrice = useMemo(() => {
    let total = 0;
    for (let i = 0; i < formData.nights; i++)
      total += getPricePerNight(formData.room, addDays(formData.date, i));
    return total;
  }, [formData.date, formData.room, formData.nights, getPricePerNight]);

  const extraPrice = useMemo(() =>
    formData.adults*20000 + formData.kids*15000 + (formData.bbq?30000:0),
    [formData.adults, formData.kids, formData.bbq]);

  const autoTotalPrice = calcStayPrice + extraPrice;

  const finalManualPrice = useMemo(() => {
    const raw = Number(manualPrice) || 0;
    if (manualPriceMode === 'pernight') return raw * formData.nights + extraPrice;
    return raw;
  }, [manualPrice, manualPriceMode, formData.nights, extraPrice]);

  const filteredReservations = useMemo(() => {
    let list = [...reservations].sort((a,b) => a.date?.localeCompare(b.date));
    if (searchFilter === 'nophone') list = list.filter(r => !r.phone || r.phone === '010');
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      list = list.filter(r => r.name?.includes(s) || r.phone?.includes(s));
    }
    return list;
  }, [reservations, searchTerm, searchFilter]);

  const resetModal = () => {
    setIsModalOpen(false); setEditTarget(null); setSelectedResId(null);
    setIsManualPrice(false); setManualPrice(''); setManualPriceMode('total'); setRoomTouched(false);
  };

  const saveStateRef = React.useRef({});
  saveStateRef.current = {
    isManualPrice, manualPrice, manualPriceMode,
    formData, editTarget, activeTab,
    autoTotalPrice, extraPrice
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const {
      isManualPrice: isMp, manualPrice: mp, manualPriceMode: mpMode,
      formData: fd, editTarget: et, activeTab: at,
      autoTotalPrice: autoP, extraPrice: extra
    } = saveStateRef.current;

    for (let i = 0; i < fd.nights; i++) {
      if (isRoomFull(fd.room, addDays(fd.date, i), et)) {
        showMsg("해당 기간에 이미 예약된 객실입니다.", "error"); return;
      }
    }

    let savePrice;
    if (isMp) {
      const raw = Number(mp) || 0;
      savePrice = mpMode === 'pernight' ? raw * fd.nights + extra : raw;
    } else {
      savePrice = autoP;
    }

    try {
      if (et) {
        await updateDoc(doc(db,'reservations',et), { ...fd, price:savePrice });
        showMsg("수정되었습니다.", "success");
      } else {
        await addDoc(collection(db,'reservations'), { ...fd, price:savePrice, createdAt:serverTimestamp() });
        showMsg("예약이 저장되었습니다.", "success");
      }
      resetModal();
      if (at==='add') setActiveTab('calendar');
    } catch { showMsg("저장 실패", "error"); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("삭제하시겠습니까?")) return;
    await deleteDoc(doc(db,'reservations',id));
    showMsg("삭제 완료", "success");
  };

  const handlePhoneChange = (e) => {
    let val = e.target.value.replace(/[^0-9]/g,'');
    if (!val.startsWith('010')) val = '010' + val;
    setFormData({ ...formData, phone:val });
  };

  const toggleManualPrice = () => {
    if (!isManualPrice) {
      setIsManualPrice(true);
      setManualPriceMode('total');
      setManualPrice(String(autoTotalPrice));
    } else {
      setIsManualPrice(false);
      setManualPrice('');
      setManualPriceMode('total');
    }
  };

  const renderForm = (isModal=false) => (
    <form onSubmit={handleSave} className="space-y-4">
      {/* 방 선택 */}
      <div className="grid grid-cols-3 gap-2">
        {ROOMS.map(r => {
          const full = isRoomFull(r.id, formData.date, editTarget);
          const rc = {Shell:{accent:'#f43f5e',bg:'#fff1f2',border:'#fecdd3'}, Beach:{accent:'#0ea5e9',bg:'#f0f9ff',border:'#bae6fd'}, Pine:{accent:'#22c55e',bg:'#f0fdf4',border:'#bbf7d0'}}[r.id];
          const isActive = formData.room === r.id;
          return (
            <button key={r.id} type="button" disabled={full}
              onClick={() => { setFormData({ ...formData, room:r.id }); setRoomTouched(true); }}
              className="p-3 rounded-xl font-black border-2 transition-all flex flex-col items-center"
              style={{
                opacity: full ? 0.4 : 1,
                background: isActive ? rc.accent : rc.bg,
                borderColor: isActive ? rc.accent : rc.border,
                color: isActive ? 'white' : rc.accent,
                boxShadow: isActive ? `0 4px 16px ${rc.accent}40` : 'none'
              }}>
              <span className="text-xs md:text-sm">{r.name}</span>
              {full && <span className="text-[10px] font-bold mt-1" style={{color:'#f43f5e'}}>예약 마감</span>}
            </button>
          );
        })}
      </div>

      {/* 기본 정보 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {!isModal && (
          <div className="flex flex-col">
            <label className="text-[10px] font-bold ml-1 mb-1" style={{color:'#94a3b8'}}>체크인 날짜</label>
            <input type="date" value={formData.date}
              onChange={e => setFormData({ ...formData, date:e.target.value })}
              className="p-3 rounded-xl font-bold border-none outline-none text-sm"
              style={{background:'#f0fdfa', color:'#0f4c5c'}} required />
          </div>
        )}
        <div className="flex flex-col">
          <label className="text-[10px] font-bold ml-1 mb-1" style={{color:'#94a3b8'}}>숙박 일수</label>
          <select value={formData.nights}
            onChange={e => setFormData({ ...formData, nights:Number(e.target.value) })}
            className="p-3 rounded-xl font-bold border-none outline-none text-sm"
            style={{background:'#f0fdfa', color:'#0f4c5c'}}>
            {[1,2,3,4,5,6,7].map(n => <option key={n} value={n}>{n}박</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold ml-1 mb-1" style={{color:'#94a3b8'}}>성함</label>
          <input type="text" placeholder="예약자명" value={formData.name}
            onChange={e => setFormData({ ...formData, name:e.target.value })}
            className="p-3 rounded-xl font-bold border-none outline-none text-sm"
            style={{background:'#f0fdfa', color:'#0f4c5c'}} required />
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold ml-1 mb-1" style={{color:'#94a3b8'}}>연락처</label>
          <input type="tel" placeholder="010-0000-0000" value={formatPhone(formData.phone)}
            onChange={handlePhoneChange}
            className="p-3 rounded-xl font-bold border-none outline-none text-sm"
            style={{background:'#f0fdfa', color:'#0f4c5c'}} />
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold ml-1 mb-1" style={{color:'#94a3b8'}}>예약 경로</label>
          <select value={formData.path}
            onChange={e => setFormData({ ...formData, path:e.target.value })}
            className="p-3 rounded-xl font-bold border-none outline-none text-sm"
            style={{background:'#f0fdfa', color:'#0f4c5c'}}>
            {PATHS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="flex flex-col md:col-span-2">
          <label className="text-[10px] font-bold ml-1 mb-1" style={{color:'#94a3b8'}}>메모</label>
          <input type="text" placeholder="특이사항, 요청사항 등" value={formData.memo}
            onChange={e => setFormData({ ...formData, memo:e.target.value })}
            className="p-3 rounded-xl font-bold border-none outline-none text-sm"
            style={{background:'#fffbeb', color:'#92400e'}} />
        </div>
      </div>

      {/* 추가요금 */}
      <div className="p-4 rounded-2xl space-y-3" style={{background:'#f0fdfa'}}>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col">
            <label className="text-[10px] font-bold mb-1 ml-1" style={{color:'#0d9488'}}>성인(8세~, 2만)</label>
            <input type="number" min="0" value={formData.adults}
              onChange={e => setFormData({ ...formData, adults:Number(e.target.value) })}
              className="p-2.5 rounded-xl border-none font-bold text-center text-sm"
              style={{background:'white', color:'#0f4c5c'}} />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] font-bold mb-1 ml-1" style={{color:'#0d9488'}}>아동(~7세, 1.5만)</label>
            <input type="number" min="0" value={formData.kids}
              onChange={e => setFormData({ ...formData, kids:Number(e.target.value) })}
              className="p-2.5 rounded-xl border-none font-bold text-center text-sm"
              style={{background:'white', color:'#0f4c5c'}} />
          </div>
        </div>
        <button type="button" onClick={() => setFormData({ ...formData, bbq:!formData.bbq })}
          className="w-full p-2.5 rounded-xl font-bold border-2 text-xs transition-all"
          style={{
            background: formData.bbq ? '#f97316' : 'white',
            borderColor: formData.bbq ? '#f97316' : '#fed7aa',
            color: formData.bbq ? 'white' : '#f97316'
          }}>
          🔥 바베큐 그릴 (30,000원) {formData.bbq ? '신청완료' : '미신청'}
        </button>
      </div>

      {/* 요금 영역 */}
      <div className="space-y-2">
        {roomTouched && (
          <div className="px-1 flex items-center justify-between">
            <span className="text-xs font-bold" style={{color:'#94a3b8'}}>
              {isManualPrice ? '직접입력 요금' : '예정 요금'}
            </span>
            <span className="text-base font-black" style={{color:'#0f4c5c'}}>
              ₩{(isManualPrice ? finalManualPrice : autoTotalPrice).toLocaleString()}
            </span>
          </div>
        )}

        {isManualPrice && (
          <div className="p-4 rounded-2xl space-y-3" style={{background:'#fffbeb', border:'2px solid #fcd34d'}}>
            <div className="flex gap-1 p-1 rounded-xl" style={{background:'#fef3c7'}}>
              <button type="button"
                onClick={() => { setManualPriceMode('total'); setManualPrice(''); }}
                className="flex-1 py-1.5 rounded-lg text-xs font-black transition-all"
                style={{background: manualPriceMode==='total' ? 'white' : 'transparent', color: manualPriceMode==='total' ? '#92400e' : '#d97706', boxShadow: manualPriceMode==='total' ? '0 1px 4px rgba(0,0,0,0.1)' : 'none'}}>
                합계 입력
              </button>
              <button type="button"
                onClick={() => { setManualPriceMode('pernight'); setManualPrice(''); }}
                className="flex-1 py-1.5 rounded-lg text-xs font-black transition-all"
                style={{background: manualPriceMode==='pernight' ? 'white' : 'transparent', color: manualPriceMode==='pernight' ? '#92400e' : '#d97706', boxShadow: manualPriceMode==='pernight' ? '0 1px 4px rgba(0,0,0,0.1)' : 'none'}}>
                1박 단가 입력
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input type="number" value={manualPrice} onChange={e => setManualPrice(e.target.value)}
                placeholder={manualPriceMode==='total' ? `합계 금액 (${formData.nights}박 전체)` : '1박 단가'}
                className="flex-1 p-3 rounded-xl outline-none font-black text-base"
                style={{background:'white', border:'2px solid #fcd34d', color:'#92400e'}} />
              <span className="text-xs font-bold shrink-0" style={{color:'#d97706'}}>원</span>
            </div>
            {manualPrice && Number(manualPrice) > 0 && (
              <div className="text-[11px] font-bold px-3 py-2 rounded-xl leading-relaxed" style={{background:'#fef3c7', color:'#92400e'}}>
                {manualPriceMode === 'total' ? (
                  formData.nights > 1 ? <>₩{Number(manualPrice).toLocaleString()} ÷ {formData.nights}박 → 1박 ₩{Math.round(Number(manualPrice)/formData.nights).toLocaleString()}으로 저장</>
                  : <>저장: ₩{Number(manualPrice).toLocaleString()}</>
                ) : (
                  <>1박 ₩{Number(manualPrice).toLocaleString()} × {formData.nights}박{extraPrice > 0 && <> + 추가요금 ₩{extraPrice.toLocaleString()}</>} = 저장: ₩{finalManualPrice.toLocaleString()}</>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={toggleManualPrice}
            className="flex-1 py-3 rounded-xl font-bold text-xs transition-all border"
            style={{
              background: isManualPrice ? '#f97316' : '#f8fafc',
              borderColor: isManualPrice ? '#f97316' : '#e2e8f0',
              color: isManualPrice ? 'white' : '#64748b'
            }}>
            {isManualPrice ? '✏️ 직접입력 중' : '가격 직접입력'}
          </button>
          <button type="submit"
            className="flex-1 py-3 rounded-xl font-black text-sm text-white transition-all"
            style={{background:'linear-gradient(135deg,#0d9488,#0f4c5c)', boxShadow:'0 4px 16px rgba(13,148,136,0.3)'}}>
            {editTarget ? "수정 완료" : "예약 저장"}
          </button>
        </div>
      </div>
    </form>
  );

  if (!isUnlocked) return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{background:'linear-gradient(135deg, #0f4c5c 0%, #0d9488 50%, #f97316 100%)'}}>
      <div className="w-full max-w-sm p-10 rounded-[2.5rem] text-center"
        style={{background:'rgba(255,251,245,0.97)', boxShadow:'0 32px 80px rgba(0,0,0,0.25)'}}>
        <div className="w-20 h-20 rounded-[1.5rem] flex items-center justify-center mx-auto mb-6"
          style={{background:'linear-gradient(135deg,#0d9488,#0f4c5c)'}}>
          <BedDouble size={36} color="white" />
        </div>
        <h1 className="text-2xl font-black mb-1 tracking-tight" style={{color:'#0f4c5c'}}>Shell Beach</h1>
        <p className="text-xs font-bold mb-8 tracking-widest uppercase" style={{color:'#0d9488'}}>Admin Console</p>
        <form onSubmit={handleLogin} className="space-y-4">
          <input type="password" maxLength={4} value={pinInput}
            onChange={e => setPinInput(e.target.value)}
            className="w-full p-4 text-center text-3xl font-black rounded-2xl outline-none transition-all"
            style={{
              background: pinError ? '#fff1f2' : '#f0fdfa',
              border: `2px solid ${pinError ? '#f43f5e' : '#99f6e4'}`,
              color:'#0f4c5c', letterSpacing:'0.5em'
            }}
            placeholder="·  ·  ·  ·" autoFocus />
          {pinError && <p className="text-xs font-bold" style={{color:'#f43f5e'}}>PIN이 올바르지 않습니다</p>}
          <button type="submit" className="w-full p-4 font-black rounded-2xl text-white transition-all"
            style={{background:'linear-gradient(135deg,#0d9488,#0f4c5c)', boxShadow:'0 8px 24px rgba(13,148,136,0.4)'}}>
            접속
          </button>
        </form>
      </div>
    </div>
  );

  const NAV_ITEMS = [
    { id:'calendar', icon:Calendar, label:'현황판' },
    { id:'add', icon:PlusCircle, label:'예약 등록' },
    { id:'search', icon:Search, label:'예약 검색' },
    { id:'stats', icon:BarChart3, label:'통계' },
    { id:'settings', icon:Settings, label:'설정' },
  ];

  return (
    <div className="flex flex-col md:flex-row h-screen font-sans" style={{background:'#FBF8F3'}}>
      {message && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[1000] px-6 py-2.5 rounded-full shadow-2xl font-bold text-sm`}
          style={{
            background: message.type==='success' ? 'linear-gradient(135deg,#0d9488,#0f4c5c)' : '#f43f5e',
            color:'white', boxShadow:'0 8px 32px rgba(0,0,0,0.2)'
          }}>
          {message.text}
        </div>
      )}
      {exitConfirm && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[1000] px-6 py-2.5 rounded-full shadow-2xl font-bold text-sm text-white"
          style={{background:'#f97316'}}>
          종료하시겠습니까? 한 번 더 누르면 종료됩니다
        </div>
      )}

      {/* 사이드바 */}
      <nav className="hidden md:flex w-64 flex-col p-5 space-y-1.5 shrink-0"
        style={{background:'linear-gradient(180deg,#0f4c5c 0%,#0d9488 100%)', boxShadow:'4px 0 24px rgba(15,76,92,0.15)'}}>
        <div className="p-5 rounded-2xl mb-3" style={{background:'rgba(255,255,255,0.1)'}}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{background:'rgba(255,255,255,0.2)'}}>
              <BedDouble size={20} color="white" />
            </div>
            <div>
              <h1 className="font-black text-white text-base tracking-tight leading-none">Shell Beach</h1>
              <p className="text-[10px] font-bold tracking-widest uppercase mt-0.5" style={{color:'rgba(255,255,255,0.6)'}}>Admin</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-lg" style={{background:'rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.8)'}}>
            <Check size={10} /> 실시간 동기화 중
          </div>
        </div>
        {NAV_ITEMS.map(item => (
          <button key={item.id} onClick={() => setActiveTab(item.id)}
            className="flex items-center gap-3 p-3.5 rounded-xl font-bold transition-all text-left"
            style={{
              background: activeTab===item.id ? 'rgba(255,255,255,0.2)' : 'transparent',
              color: activeTab===item.id ? 'white' : 'rgba(255,255,255,0.6)',
              boxShadow: activeTab===item.id ? '0 4px 16px rgba(0,0,0,0.1)' : 'none'
            }}>
            <item.icon size={18} />
            <span className="text-sm">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* 메인 */}
      <main className="flex-1 overflow-auto relative pb-20 md:pb-0">
        {loading && (
          <div className="absolute inset-0 z-50 flex items-center justify-center font-black text-sm tracking-widest uppercase"
            style={{background:'rgba(251,248,243,0.8)', backdropFilter:'blur(8px)', color:'#0d9488'}}>
            Syncing...
          </div>
        )}
        <div className="p-4 md:p-6 max-w-[1300px] mx-auto">

          {activeTab==='calendar' && (
            <div className="space-y-4">
              <header className="flex flex-col md:flex-row justify-between items-center p-4 md:p-5 rounded-2xl"
                style={{background:'white', boxShadow:'0 2px 16px rgba(15,76,92,0.08)', border:'1px solid rgba(15,76,92,0.08)'}}>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{background:'linear-gradient(135deg,#0d9488,#0f4c5c)'}}>
                    <Calendar size={20} color="white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black tracking-tight" style={{color:'#0f4c5c'}}>{viewDate.getFullYear()}년 {viewDate.getMonth()+1}월</h2>
                    <p className="text-sm font-black mt-0.5" style={{color:'#0d9488'}}>
                      ₩{(stats.monthlyMap[`${viewDate.getFullYear()}-${String(viewDate.getMonth()+1).padStart(2,'0')}`]?.total||0).toLocaleString()}
                      <span className="font-bold text-xs ml-1" style={{color:'#94a3b8'}}>월 매출</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3 md:mt-0">
                  {/* 주간/월간 토글 */}
                  <div className="flex gap-1 p-1 rounded-xl" style={{background:'#f0fdfa'}}>
                    <button onClick={() => setCalendarView('month')}
                      className="px-3 py-1.5 rounded-lg text-xs font-black transition-all"
                      style={{background: calendarView==='month' ? '#0d9488' : 'transparent', color: calendarView==='month' ? 'white' : '#0d9488'}}>
                      월
                    </button>
                    <button onClick={() => setCalendarView('week')}
                      className="px-3 py-1.5 rounded-lg text-xs font-black transition-all"
                      style={{background: calendarView==='week' ? '#0d9488' : 'transparent', color: calendarView==='week' ? 'white' : '#0d9488'}}>
                      주
                    </button>
                  </div>
                  <div className="flex gap-1.5 p-1.5 rounded-xl" style={{background:'#f0fdfa'}}>
                    <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth()-1,1))}
                      className="p-1.5 rounded-lg transition-all hover:bg-white" style={{color:'#0d9488'}}><ChevronLeft size={18} /></button>
                    <button onClick={() => setViewDate(new Date())}
                      className="px-4 font-bold text-[11px] rounded-lg transition-all" style={{color:'#0d9488'}}>오늘</button>
                    <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth()+1,1))}
                      className="p-1.5 rounded-lg transition-all hover:bg-white" style={{color:'#0d9488'}}><ChevronRight size={18} /></button>
                  </div>
                </div>
              </header>

              {/* 요약 카드 */}
              {(() => {
                const today = getLocalTodayStr();
                const ym = `${viewDate.getFullYear()}-${String(viewDate.getMonth()+1).padStart(2,'0')}`;
                const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth()+1, 0).getDate();
                // 이번달 남은 날
                let remainEmpty = 0;
                for (let d = 1; d <= daysInMonth; d++) {
                  const ds = `${ym}-${String(d).padStart(2,'0')}`;
                  if (ds >= today && (!reservationMap[ds] || reservationMap[ds].length < 3)) remainEmpty++;
                }
                // 다음달 예약 건수
                const nextYm = (() => { const nd = new Date(viewDate.getFullYear(), viewDate.getMonth()+1, 1); return `${nd.getFullYear()}-${String(nd.getMonth()+1).padStart(2,'0')}`; })();
                const nextMonthCount = reservations.filter(r => r.date?.startsWith(nextYm)).length;
                // 이번달 점유박수
                const nights = stats.monthlyNights[ym] || {Shell:0,Beach:0,Pine:0};
                return (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      {label:'이번달 잔여일', value:`${remainEmpty}일`, sub:'빈 날짜', color:'#0d9488'},
                      {label:'다음달 예약', value:`${nextMonthCount}건`, sub:'확정', color:'#f97316'},
                      {label:'Shell 점유', value:`${nights.Shell}박`, sub:'이번달', color:'#f43f5e'},
                      {label:'Beach·Pine', value:`${nights.Beach+nights.Pine}박`, sub:'이번달', color:'#8b5cf6'},
                    ].map(c => (
                      <div key={c.label} className="p-4 rounded-2xl" style={{background:'white', boxShadow:'0 2px 12px rgba(15,76,92,0.06)'}}>
                        <p className="text-[10px] font-bold" style={{color:'#94a3b8'}}>{c.label}</p>
                        <p className="text-2xl font-black mt-1" style={{color:c.color}}>{c.value}</p>
                        <p className="text-[10px] font-bold mt-0.5" style={{color:'#cbd5e1'}}>{c.sub}</p>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* 월간 뷰 */}
              {calendarView === 'month' && (
              <div className="grid grid-cols-7 rounded-2xl overflow-hidden" style={{background:'white', boxShadow:'0 4px 24px rgba(15,76,92,0.1)', border:'1px solid rgba(15,76,92,0.08)'}}>
                {['일','월','화','수','목','금','토'].map((d,i) => (
                  <div key={d} className="p-2 text-center text-[10px] font-black border-b"
                    style={{borderColor:'rgba(15,76,92,0.08)', color: i===0?'#f43f5e': i===6?'#0d9488':'#94a3b8', background: i===0?'#fff1f2': i===6?'#f0fdfa':'#fafaf9'}}>{d}</div>
                ))}
                {Array.from({length:42}).map((_,i) => {
                  const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
                  const day = i - firstDay + 1;
                  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth()+1, 0).getDate();
                  const dateStr = day>0 && day<=daysInMonth
                    ? `${viewDate.getFullYear()}-${String(viewDate.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
                    : null;
                  const dayRes = dateStr ? (reservationMap[dateStr]||[]) : [];
                  const holidayName = dateStr ? (rateConfig.holidayNames?.[dateStr] || null) : null;
                  const isHoliday = dateStr ? (new Set(rateConfig.holidays||[]).has(dateStr)) : false;
                  const dow = dateStr ? new Date(dateStr+'T00:00:00').getDay() : -1;
                  const today = getLocalTodayStr();
                  const isToday = dateStr === today;
                  // D-1 체크아웃: 내일 체크아웃하는 예약이 있는지 (오늘이 마지막 박)
                  const hasDayMinus1 = dateStr ? reservations.some(r => {
                    const checkout = addDays(r.date, r.nights||1);
                    return addDays(dateStr, 1) === checkout;
                  }) : false;
                  return (
                    <div key={i} onClick={() => {
                      if (!dateStr) return;
                      setFormData({ date:dateStr, room:'Shell', name:'', phone:'010', adults:0, kids:0, bbq:false, nights:1, memo:'', path:'직접' });
                      setEditTarget(null); setSelectedResId(null);
                      setIsManualPrice(false); setManualPrice(''); setManualPriceMode('total'); setRoomTouched(false);
                      setIsModalOpen(true);
                    }}
                      className="min-h-[80px] md:min-h-[110px] p-1.5 border-r border-b cursor-pointer transition-all relative"
                      style={{borderColor:'rgba(15,76,92,0.06)', background: !dateStr ? '#faf9f7' : isToday ? '#f0fdfa' : isHoliday ? '#fff1f2' : 'white'}}
                      onMouseEnter={e => { if(dateStr) e.currentTarget.style.background = '#e0f9f5'; }}
                      onMouseLeave={e => { if(dateStr) e.currentTarget.style.background = !dateStr ? '#faf9f7' : isToday ? '#f0fdfa' : isHoliday ? '#fff1f2' : 'white'; }}>
                      {dateStr && (
                        <>
                          <div className="flex items-center gap-1">
                            {isToday ? (
                              <span className="text-xs font-black w-5 h-5 rounded-full flex items-center justify-center text-white" style={{background:'#0d9488'}}>{day}</span>
                            ) : (
                              <span className="text-xs font-black" style={{color: dow===0||isHoliday ? '#f43f5e' : dow===6 ? '#0d9488' : '#334155'}}>{day}</span>
                            )}
                            {hasDayMinus1 && (
                              <span className="text-[7px] font-black px-1 rounded" style={{background:'#fef3c7', color:'#d97706'}}>D-1</span>
                            )}
                          </div>
                          {holidayName && (
                            <div className="text-[7px] font-black leading-tight truncate" style={{color:'#f43f5e'}}>{holidayName}</div>
                          )}
                          {!holidayName && isHoliday && (
                            <div className="text-[7px] font-black leading-tight" style={{color:'#fb7185'}}>공휴일</div>
                          )}
                          <div className="mt-0.5 space-y-0.5">
                            {['Shell','Beach','Pine'].map(roomId => {
                              const r = dayRes.find(x => x.room === roomId);
                              if (!r) return null;
                              const colors = {
                                Shell: {bg:'#fff1f2', text:'#be123c', border:'#fecdd3', dot:'#f43f5e'},
                                Beach: {bg:'#f0f9ff', text:'#0369a1', border:'#bae6fd', dot:'#0ea5e9'},
                                Pine:  {bg:'#f0fdf4', text:'#15803d', border:'#bbf7d0', dot:'#22c55e'},
                              };
                              const c = colors[roomId];
                              return (
                                <div key={roomId} className="text-[8px] p-0.5 rounded-md font-bold truncate flex items-center gap-0.5"
                                  style={{background:c.bg, color:c.text, border:`1px solid ${c.border}`}}>
                                  <div className="w-1 h-1 rounded-full shrink-0" style={{background:c.dot}}></div>
                                  <span className="shrink-0 opacity-70">{roomId[0]}</span>
                                  <span className="truncate ml-0.5">{r.name}</span>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              )}

              {/* 주간 뷰 */}
              {calendarView === 'week' && (() => {
                const today = getLocalTodayStr();
                // viewDate 기준 해당 주 일요일 찾기
                const base = new Date(viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate());
                const sundayOffset = base.getDay();
                const sunday = new Date(base); sunday.setDate(base.getDate() - sundayOffset);
                const weekDates = Array.from({length:7}, (_,i) => {
                  const d = new Date(sunday); d.setDate(sunday.getDate()+i);
                  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                });
                return (
                  <div className="rounded-2xl overflow-hidden" style={{background:'white', boxShadow:'0 4px 24px rgba(15,76,92,0.1)'}}>
                    <div className="grid grid-cols-7 border-b" style={{borderColor:'rgba(15,76,92,0.08)'}}>
                      {['일','월','화','수','목','금','토'].map((d,i) => (
                        <div key={d} className="p-2 text-center text-[10px] font-black"
                          style={{color: i===0?'#f43f5e': i===6?'#0d9488':'#94a3b8', background: i===0?'#fff1f2': i===6?'#f0fdfa':'#fafaf9'}}>{d}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7">
                      {weekDates.map((dateStr, i) => {
                        const d = new Date(dateStr+'T00:00:00');
                        const dayRes = reservationMap[dateStr]||[];
                        const isToday = dateStr === today;
                        const isHoliday = new Set(rateConfig.holidays||[]).has(dateStr);
                        const holidayName = rateConfig.holidayNames?.[dateStr] || null;
                        const hasDayMinus1 = reservations.some(r => addDays(dateStr,1) === addDays(r.date, r.nights||1));
                        return (
                          <div key={dateStr} onClick={() => {
                            setFormData({ date:dateStr, room:'Shell', name:'', phone:'010', adults:0, kids:0, bbq:false, nights:1, memo:'', path:'직접' });
                            setEditTarget(null); setSelectedResId(null);
                            setIsManualPrice(false); setManualPrice(''); setManualPriceMode('total'); setRoomTouched(false);
                            setIsModalOpen(true);
                          }}
                            className="min-h-[140px] p-2 border-r cursor-pointer transition-all"
                            style={{borderColor:'rgba(15,76,92,0.06)', background: isToday ? '#f0fdfa' : isHoliday ? '#fff1f2' : 'white'}}
                            onMouseEnter={e => e.currentTarget.style.background='#e0f9f5'}
                            onMouseLeave={e => e.currentTarget.style.background= isToday ? '#f0fdfa' : isHoliday ? '#fff1f2' : 'white'}>
                            <div className="flex items-center gap-1 mb-1">
                              {isToday ? (
                                <span className="text-sm font-black w-6 h-6 rounded-full flex items-center justify-center text-white" style={{background:'#0d9488'}}>{d.getDate()}</span>
                              ) : (
                                <span className="text-sm font-black" style={{color: i===0||isHoliday?'#f43f5e':i===6?'#0d9488':'#334155'}}>{d.getDate()}</span>
                              )}
                              {hasDayMinus1 && <span className="text-[8px] font-black px-1 rounded" style={{background:'#fef3c7',color:'#d97706'}}>D-1</span>}
                            </div>
                            {holidayName && <div className="text-[8px] font-black mb-1 truncate" style={{color:'#f43f5e'}}>{holidayName}</div>}
                            <div className="space-y-1">
                              {['Shell','Beach','Pine'].map(roomId => {
                                const r = dayRes.find(x => x.room === roomId);
                                const colors = {Shell:{bg:'#fff1f2',text:'#be123c',border:'#fecdd3'},Beach:{bg:'#f0f9ff',text:'#0369a1',border:'#bae6fd'},Pine:{bg:'#f0fdf4',text:'#15803d',border:'#bbf7d0'}};
                                const c = colors[roomId];
                                return (
                                  <div key={roomId} className="text-[9px] p-1 rounded-lg font-bold"
                                    style={{background: r ? c.bg : '#f8fafc', color: r ? c.text : '#cbd5e1', border:`1px solid ${r ? c.border : '#f1f5f9'}`}}>
                                    <span className="opacity-60">{roomId[0]}</span>
                                    {r ? <span className="ml-1 truncate block">{r.name}</span> : <span className="ml-1 opacity-30">—</span>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {/* 주간 이동 버튼 */}
                    <div className="flex justify-between items-center p-3 border-t" style={{borderColor:'rgba(15,76,92,0.08)'}}>
                      <button onClick={() => setViewDate(new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate()-7))}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold"
                        style={{background:'#f0fdfa', color:'#0d9488'}}>
                        <ChevronLeft size={14}/> 이전 주
                      </button>
                      <span className="text-xs font-bold" style={{color:'#94a3b8'}}>{weekDates[0].slice(5)} ~ {weekDates[6].slice(5)}</span>
                      <button onClick={() => setViewDate(new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate()+7))}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold"
                        style={{background:'#f0fdfa', color:'#0d9488'}}>
                        다음 주 <ChevronRight size={14}/>
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {activeTab==='add' && (
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="p-6 md:p-10 rounded-2xl" style={{background:'white', boxShadow:'0 4px 24px rgba(15,76,92,0.1)'}}>
                <h2 className="text-2xl font-black mb-8 pb-5 flex items-center gap-3" style={{color:'#0f4c5c', borderBottom:'2px solid #f0fdfa'}}>
                  <PlusCircle style={{color:'#0d9488'}} /> 신규 예약 등록
                </h2>
                {renderForm(false)}
              </div>
            </div>
          )}

          {activeTab==='search' && (
            <div className="max-w-3xl mx-auto space-y-5">
              <h2 className="text-2xl font-black" style={{color:'#0f4c5c'}}>예약 내역 검색</h2>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-5 top-1/2 -translate-y-1/2" size={20} style={{color:'#0d9488'}} />
                  <input type="text" placeholder="성함 또는 연락처 입력..."
                    className="w-full p-4 pl-14 text-base font-bold outline-none rounded-2xl transition-all"
                    style={{background:'white', border:'2px solid #e2e8f0', color:'#0f4c5c'}}
                    onFocus={e => e.target.style.borderColor='#0d9488'}
                    onBlur={e => e.target.style.borderColor='#e2e8f0'}
                    value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
                {/* 전화번호 미입력 필터 */}
                <button onClick={() => setSearchFilter(f => f==='nophone'?'all':'nophone')}
                  className="px-4 py-2 rounded-2xl font-black text-xs flex items-center gap-1.5 transition-all"
                  style={{
                    background: searchFilter==='nophone' ? '#f43f5e' : 'white',
                    color: searchFilter==='nophone' ? 'white' : '#f43f5e',
                    border: '2px solid #fecdd3'
                  }}>
                  <AlertCircle size={14}/> 번호없음
                </button>
              </div>
              {searchFilter==='nophone' && (
                <div className="px-4 py-2 rounded-xl text-xs font-bold" style={{background:'#fff1f2', color:'#f43f5e'}}>
                  전화번호 미입력 예약 {filteredReservations.length}건 표시 중
                </div>
              )}
              <div className="space-y-3">
                {filteredReservations.length > 0 ? filteredReservations.map(r => {
                  const rc = {Shell:{accent:'#f43f5e',bg:'#fff1f2'}, Beach:{accent:'#0ea5e9',bg:'#f0f9ff'}, Pine:{accent:'#22c55e',bg:'#f0fdf4'}}[r.room]||{accent:'#94a3b8',bg:'#f8fafc'};
                  return (
                    <div key={r.id} className="p-5 rounded-2xl flex flex-col md:flex-row justify-between md:items-start gap-4 transition-all"
                      style={{background:'white', boxShadow:'0 2px 12px rgba(15,76,92,0.06)', borderLeft:`4px solid ${rc.accent}`}}>
                      <div className="flex items-start gap-4 flex-1">
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg shrink-0"
                          style={{background:rc.bg, color:rc.accent}}>
                          {r.room?r.room[0]:'?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-lg font-black" style={{color:'#0f4c5c'}}>{r.name}님
                            <span className="text-[11px] font-bold ml-2 px-2 py-0.5 rounded-md uppercase" style={{background:rc.bg, color:rc.accent}}>{r.room}</span>
                          </p>
                          <p className="font-bold mt-0.5 text-xs" style={{color:'#94a3b8'}}>{r.date} 입실 · {r.nights}박 · {r.path||'-'}</p>
                          {r.phone ? (
                            <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1.5 mt-1.5 font-bold hover:underline px-3 py-1 rounded-full text-[11px]"
                              style={{background:rc.bg, color:rc.accent}}>
                              <Phone size={11} /> {formatPhone(r.phone)}
                            </a>
                          ) : (
                            <span className="inline-flex items-center gap-1 mt-1.5 text-[11px] font-bold px-3 py-1 rounded-full" style={{background:'#fff1f2', color:'#f43f5e'}}>
                              <AlertCircle size={10}/> 번호 없음
                            </span>
                          )}
                          {/* 메모 표시 */}
                          {r.memo && (
                            <div className="mt-2 text-xs font-bold px-3 py-1.5 rounded-xl" style={{background:'#fffbeb', color:'#92400e'}}>
                              📝 {r.memo}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between items-center md:flex-col md:items-end gap-2 border-t md:border-t-0 pt-3 md:pt-0 shrink-0" style={{borderColor:'#f1f5f9'}}>
                        <p className="text-xl font-black" style={{color:'#0f4c5c'}}>₩{(Number(r.price)||0).toLocaleString()}</p>
                        <div className="flex gap-2">
                          {/* 예약 복사 */}
                          <button onClick={() => {
                            setFormData({ date:getLocalTodayStr(), room:r.room, name:r.name, phone:r.phone||'010',
                              adults:r.adults||0, kids:r.kids||0, bbq:r.bbq||false,
                              nights:r.nights||1, memo:r.memo||'', path:r.path||'직접' });
                            setEditTarget(null); setIsManualPrice(false); setManualPrice('');
                            setManualPriceMode('total'); setRoomTouched(true); setActiveTab('add');
                            showMsg(`${r.name}님 정보 복사 완료 — 날짜를 변경하세요`, 'success');
                          }} className="font-black text-[10px] px-3 py-1.5 rounded-lg transition-all flex items-center gap-1"
                            style={{background:'#f0fdfa', color:'#0d9488'}}>
                            <Copy size={10}/> 복사
                          </button>
                          <button onClick={() => {
                            setFormData({ date:r.date, room:r.room, name:r.name, phone:r.phone||'010',
                              adults:r.adults||0, kids:r.kids||0, bbq:r.bbq||false,
                              nights:r.nights||1, memo:r.memo||'', path:r.path||'직접' });
                            setEditTarget(r.id); setIsManualPrice(false); setManualPrice('');
                            setManualPriceMode('total'); setRoomTouched(true); setIsModalOpen(true);
                          }} className="font-black text-[10px] px-3 py-1.5 rounded-lg transition-all"
                            style={{background:'#f0fdfa', color:'#0d9488'}}>수정</button>
                          <button onClick={() => handleDelete(r.id)}
                            className="font-black text-[10px] px-3 py-1.5 rounded-lg transition-all"
                            style={{background:'#fff1f2', color:'#f43f5e'}}>삭제</button>
                        </div>
                      </div>
                    </div>
                  );
                }) : <div className="p-20 text-center font-bold text-sm rounded-2xl border-2 border-dashed" style={{color:'#94a3b8', borderColor:'#e2e8f0', background:'white'}}>검색 결과가 없습니다.</div>}
              </div>
            </div>
          )}

          {activeTab==='stats' && (
            <div className="max-w-5xl mx-auto space-y-6">
              <button onClick={() => {
                const header = '체크인,방,이름,연락처,박수,경로,성인,아동,BBQ,금액,메모';
                const rows = [...reservations].sort((a,b)=>a.date?.localeCompare(b.date)).map(r =>
                  [r.date, r.room, r.name, r.phone ? formatPhone(r.phone) : '', r.nights, r.path||'',
                   r.adults||0, r.kids||0, r.bbq?'Y':'N', r.price||0, r.memo||''].join(',')
                );
                const csv = '\uFEFF' + [header, ...rows].join('\n');
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8;' }));
                a.download = 'shellbeach_' + new Date().toISOString().slice(0,10) + '.csv';
                a.click();
              }}
                className="w-full flex items-center justify-center gap-2 p-4 font-bold rounded-2xl text-white transition-all"
                style={{background:'linear-gradient(135deg,#0f4c5c,#0d9488)', boxShadow:'0 4px 16px rgba(13,148,136,0.3)'}}>
                <Download size={18} /> 전체 예약 CSV 내보내기 ({reservations.length}건)
              </button>

              {/* 핵심 지표 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-center">
                <div className="p-8 rounded-2xl text-white relative overflow-hidden"
                  style={{background:'linear-gradient(135deg,#0f4c5c,#0d9488)', boxShadow:'0 8px 32px rgba(15,76,92,0.25)'}}>
                  <div className="absolute -right-4 -top-4 opacity-10"><Wallet size={100} /></div>
                  <p className="font-bold text-xs" style={{color:'rgba(255,255,255,0.7)'}}>{viewDate.getFullYear()} 누적 총 매출</p>
                  <p className="text-3xl font-black mt-2">₩{Object.entries(stats.monthlyMap).filter(([k])=>k.startsWith(String(viewDate.getFullYear()))).reduce((s,[,v])=>s+v.total,0).toLocaleString()}</p>
                </div>
                <div className="p-8 rounded-2xl relative overflow-hidden"
                  style={{background:'white', boxShadow:'0 4px 16px rgba(15,76,92,0.08)'}}>
                  <div className="absolute -right-4 -top-4 opacity-5"><Users size={100} /></div>
                  <p className="font-bold text-xs" style={{color:'#94a3b8'}}>총 예약 건수</p>
                  <p className="text-3xl font-black mt-2" style={{color:'#0f4c5c'}}>{stats.count}건</p>
                </div>
              </div>

              {/* 예약 경로별 매출 */}
              <div className="p-6 rounded-2xl" style={{background:'white', boxShadow:'0 4px 16px rgba(15,76,92,0.08)'}}>
                <h4 className="font-black text-base mb-4 flex items-center gap-2" style={{color:'#0f4c5c'}}>
                  <TrendingUp size={16} style={{color:'#0d9488'}}/> 예약 경로별 매출
                </h4>
                <div className="space-y-2">
                  {Object.entries(stats.pathMap)
                    .sort(([,a],[,b]) => b.revenue - a.revenue)
                    .map(([path, data]) => {
                      const totalRev = Object.values(stats.pathMap).reduce((s,v)=>s+v.revenue,0);
                      const pct = totalRev > 0 ? Math.round(data.revenue/totalRev*100) : 0;
                      return (
                        <div key={path}>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-bold" style={{color:'#334155'}}>{path}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-bold" style={{color:'#94a3b8'}}>{data.count}건</span>
                              <span className="text-xs font-black" style={{color:'#0d9488'}}>₩{data.revenue.toLocaleString()}</span>
                              <span className="text-xs font-black w-10 text-right" style={{color:'#0f4c5c'}}>{pct}%</span>
                            </div>
                          </div>
                          <div className="h-2 rounded-full overflow-hidden" style={{background:'#f0fdfa'}}>
                            <div className="h-full rounded-full transition-all" style={{width:`${pct}%`, background:'linear-gradient(90deg,#0d9488,#0f4c5c)'}}></div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* 월별 매출 + 점유박수 */}
              <div className="p-6 md:p-8 rounded-2xl overflow-x-auto" style={{background:'white', boxShadow:'0 4px 16px rgba(15,76,92,0.08)'}}>
                <div className="flex items-center justify-between mb-6">
                  <h4 className="font-black text-lg flex items-center gap-2" style={{color:'#0f4c5c'}}>
                    <TableProperties style={{color:'#0d9488'}} size={18} /> {viewDate.getFullYear()}년 월별 매출
                  </h4>
                  <div className="flex gap-1 p-1 rounded-xl" style={{background:'#f0fdfa'}}>
                    <button onClick={() => setViewDate(new Date(viewDate.getFullYear()-1, viewDate.getMonth(), 1))}
                      className="p-1.5 rounded-lg" style={{color:'#0d9488'}}><ChevronLeft size={16} /></button>
                    <span className="px-3 text-sm font-black self-center" style={{color:'#0f4c5c'}}>{viewDate.getFullYear()}</span>
                    <button onClick={() => setViewDate(new Date(viewDate.getFullYear()+1, viewDate.getMonth(), 1))}
                      className="p-1.5 rounded-lg" style={{color:'#0d9488'}}><ChevronRight size={16} /></button>
                  </div>
                </div>
                <table className="w-full text-left min-w-[600px]">
                  <thead>
                    <tr className="text-[11px] font-black uppercase" style={{borderBottom:'2px solid #f0fdfa', color:'#94a3b8'}}>
                      <th className="py-3 pl-4">월</th>
                      <th>Shell</th><th>Beach</th><th>Pine</th>
                      <th style={{color:'#64748b'}}>Shell박</th><th style={{color:'#64748b'}}>Beach박</th><th style={{color:'#64748b'}}>Pine박</th>
                      <th className="py-3 pr-4 text-right" style={{color:'#0f4c5c'}}>합계</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs">
                    {Array.from({length:12}, (_,i) => {
                      const ym = `${viewDate.getFullYear()}-${String(i+1).padStart(2,'0')}`;
                      const s = stats.monthlyMap[ym] || { Shell:0, Beach:0, Pine:0, total:0 };
                      const n = stats.monthlyNights[ym] || { Shell:0, Beach:0, Pine:0 };
                      return (
                        <tr key={i} className="transition-all" style={{borderBottom:'1px solid #f8fafc', opacity: s.total===0?0.25:1}}>
                          <td className="py-3 pl-4 font-bold" style={{color:'#334155'}}>{i+1}월</td>
                          <td style={{color:'#be123c'}}>₩{s.Shell.toLocaleString()}</td>
                          <td style={{color:'#0369a1'}}>₩{s.Beach.toLocaleString()}</td>
                          <td style={{color:'#15803d'}}>₩{s.Pine.toLocaleString()}</td>
                          <td className="text-center"><span className="px-1.5 py-0.5 rounded text-[10px] font-black" style={{background:'#fff1f2', color:'#be123c'}}>{n.Shell}박</span></td>
                          <td className="text-center"><span className="px-1.5 py-0.5 rounded text-[10px] font-black" style={{background:'#f0f9ff', color:'#0369a1'}}>{n.Beach}박</span></td>
                          <td className="text-center"><span className="px-1.5 py-0.5 rounded text-[10px] font-black" style={{background:'#f0fdf4', color:'#15803d'}}>{n.Pine}박</span></td>
                          <td className="pr-4 font-black text-right" style={{color:'#0d9488'}}>₩{s.total.toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab==='settings' && (
            <SettingsTab
              rateConfig={rateConfig}
              onSave={async (newCfg) => {
                setLoading(true);
                try {
                  await setDoc(doc(db,'config','rateConfig'), newCfg);
                  setRateConfig(newCfg);
                  showMsg('요금 설정 저장 완료', 'success');
                } catch { showMsg('저장 실패', 'error'); }
                setLoading(false);
              }}
            />
          )}
        </div>
      </main>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around px-2 py-1"
        style={{background:'white', borderTop:'1px solid rgba(15,76,92,0.1)', boxShadow:'0 -4px 20px rgba(15,76,92,0.08)'}}>
        {NAV_ITEMS.map(item => (
          <button key={item.id} onClick={() => setActiveTab(item.id)}
            className="flex flex-col items-center justify-center gap-1 flex-1 py-2 rounded-xl transition-all">
            <item.icon size={22} strokeWidth={activeTab===item.id?2.5:1.8}
              style={{color: activeTab===item.id?'#0d9488':'#94a3b8'}} />
            <span className="text-[10px] font-black" style={{color: activeTab===item.id?'#0d9488':'#94a3b8'}}>{item.label}</span>
          </button>
        ))}
      </nav>

      {isModalOpen && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-4"
          style={{background:'rgba(15,76,92,0.5)', backdropFilter:'blur(8px)'}}
          onClick={resetModal}>
          <div className="w-full max-w-xl rounded-2xl p-6 md:p-8 relative overflow-y-auto max-h-[92vh]"
            style={{background:'white', boxShadow:'0 32px 80px rgba(15,76,92,0.25)'}}
            onClick={e => e.stopPropagation()}>
            <button onClick={resetModal}
              className="absolute top-5 right-5 p-2 rounded-full transition-all"
              style={{background:'#f1f5f9', color:'#64748b'}}
              onMouseEnter={e=>{e.currentTarget.style.background='#f43f5e';e.currentTarget.style.color='white'}}
              onMouseLeave={e=>{e.currentTarget.style.background='#f1f5f9';e.currentTarget.style.color='#64748b'}}>
              <X size={18} />
            </button>

            <div className="mb-5">
              <h3 className="text-2xl font-black" style={{color:'#0f4c5c'}}>{formData.date}</h3>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <p className="font-bold text-[10px] tracking-widest uppercase" style={{color:'#0d9488'}}>Daily Reservation View</p>
                {(() => {
                  const hName = rateConfig.holidayNames?.[formData.date];
                  const isHol = new Set(rateConfig.holidays||[]).has(formData.date);
                  if (!isHol) return null;
                  return (
                    <span className="px-2.5 py-0.5 font-black text-[10px] rounded-full"
                      style={{background:'#fff1f2', color:'#f43f5e'}}>
                      🎌 {hName || '공휴일'}
                    </span>
                  );
                })()}
              </div>
              {(reservationMap[formData.date]||[]).length > 0 && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {selectedResId ? (
                    (() => {
                      const sel = (reservationMap[formData.date]||[]).find(r => r.id === selectedResId);
                      if (!sel) return null;
                      const nightIdx = Math.round((new Date(formData.date+'T00:00:00') - new Date(sel.date+'T00:00:00')) / 86400000);
                      const selExtra = (sel.adults||0)*20000 + (sel.kids||0)*15000 + (sel.bbq?30000:0);
                      const dayPrice = Math.round(((Number(sel.price)||0) - selExtra) / (sel.nights||1));
                      const extraCard = nightIdx === 0 ? selExtra : 0;
                      return (
                        <span className="px-3 py-1.5 rounded-full text-xs font-black text-white"
                          style={{background:'linear-gradient(135deg,#0d9488,#0f4c5c)'}}>
                          {sel.name}님 · ₩{(dayPrice + extraCard).toLocaleString()} ({nightIdx+1}박째)
                        </span>
                      );
                    })()
                  ) : (
                    <span className="px-3 py-1.5 rounded-full text-xs font-black text-white"
                      style={{background:'#0f4c5c'}}>
                      합계 · ₩{(reservationMap[formData.date]||[]).reduce((s,r) => {
                          const nightIdx = Math.round((new Date(formData.date+'T00:00:00') - new Date(r.date+'T00:00:00')) / 86400000);
                          const rExtra = (r.adults||0)*20000 + (r.kids||0)*15000 + (r.bbq?30000:0);
                          const dayPrice = Math.round(((Number(r.price)||0) - rExtra) / (r.nights||1));
                          const extra = nightIdx === 0 ? rExtra : 0;
                          return s + dayPrice + extra;
                        }, 0).toLocaleString()}
                    </span>
                  )}
                  {selectedResId && (
                    <button onClick={() => { setSelectedResId(null); setEditTarget(null); }}
                      className="px-3 py-1.5 rounded-full text-xs font-bold transition-all"
                      style={{background:'#f1f5f9', color:'#64748b'}}>
                      전체보기
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="mb-6 space-y-2.5">
              {(reservationMap[formData.date]||[]).length > 0 ? (
                reservationMap[formData.date].map((r,i) => {
                  const isSelected = selectedResId === r.id;
                  const rc = {Shell:{accent:'#f43f5e',bg:'#fff1f2',border:'#fecdd3'}, Beach:{accent:'#0ea5e9',bg:'#f0f9ff',border:'#bae6fd'}, Pine:{accent:'#22c55e',bg:'#f0fdf4',border:'#bbf7d0'}}[r.room]||{accent:'#94a3b8',bg:'#f8fafc',border:'#e2e8f0'};
                  return (
                    <div key={`${r.id}-${i}`}
                      onClick={() => {
                        if (selectedResId === r.id) {
                          setSelectedResId(null); setEditTarget(null);
                          setFormData({ date:formData.date, room:'Shell', name:'', phone:'010', adults:0, kids:0, bbq:false, nights:1, memo:'', path:'직접' });
                          setIsManualPrice(false); setManualPrice(''); setManualPriceMode('total'); setRoomTouched(false);
                        } else {
                          setSelectedResId(r.id); setEditTarget(r.id);
                          setFormData({ date:r.date, room:r.room, name:r.name, phone:r.phone||'010',
                            adults:r.adults||0, kids:r.kids||0, bbq:r.bbq||false,
                            nights:r.nights||1, memo:r.memo||'', path:r.path||'직접' });
                          setIsManualPrice(false); setManualPrice(''); setManualPriceMode('total'); setRoomTouched(true);
                        }
                      }}
                      className="p-4 rounded-2xl cursor-pointer transition-all"
                      style={{
                        background: rc.bg,
                        border: `1.5px solid ${isSelected ? rc.accent : rc.border}`,
                        boxShadow: isSelected ? `0 4px 16px ${rc.accent}30` : '0 1px 4px rgba(0,0,0,0.04)'
                      }}>
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-black text-base" style={{color:rc.accent}}>{r.room}</span>
                            <span className="font-bold text-sm" style={{color:'#334155'}}>{r.name}님</span>
                            <span className="font-black text-sm" style={{color:'#0f4c5c'}}>
                              ₩{(() => {
                                const nightIdx = Math.round((new Date(formData.date+'T00:00:00') - new Date(r.date+'T00:00:00')) / 86400000);
                                const rExtra = (r.adults||0)*20000 + (r.kids||0)*15000 + (r.bbq?30000:0);
                                const dayPrice = Math.round(((Number(r.price)||0) - rExtra) / (r.nights||1));
                                const extra = nightIdx === 0 ? rExtra : 0;
                                return (dayPrice + extra).toLocaleString();
                              })()}
                            </span>
                          </div>
                          <div className="text-[10px] font-bold mt-1.5 flex items-center gap-2 flex-wrap" style={{color:'#94a3b8'}}>
                            {r.phone && (
                              <a href={`tel:${r.phone}`} onClick={e => e.stopPropagation()}
                                className="underline flex items-center gap-1" style={{color:rc.accent}}>
                                <Phone size={10}/>{formatPhone(r.phone)}
                              </a>
                            )}
                            <span>{r.nights}박</span>
                            {r.adults > 0 && <span>성인 {r.adults}</span>}
                            {r.kids > 0 && <span>아동 {r.kids}</span>}
                            {r.path && <span className="px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.7)'}}>{r.path}</span>}
                          </div>
                        </div>
                        {isSelected && (
                          <div className="flex gap-2 ml-2 shrink-0" onClick={e => e.stopPropagation()}>
                            <button onClick={() => handleDelete(r.id)}
                              className="p-2 rounded-xl transition-all"
                              style={{background:'rgba(255,255,255,0.7)', color:'#f43f5e'}}
                              onMouseEnter={e=>{e.currentTarget.style.background='#f43f5e';e.currentTarget.style.color='white'}}
                              onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,0.7)';e.currentTarget.style.color='#f43f5e'}}>
                              <Trash2 size={16} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-8 rounded-2xl text-center font-bold text-xs border-2 border-dashed"
                  style={{color:'#94a3b8', borderColor:'#e2e8f0', background:'#fafaf9'}}>
                  등록된 예약 내역이 없습니다.
                </div>
              )}
            </div>

            <div className="pt-6" style={{borderTop:'2px solid #f0fdfa'}}>
              <h4 className="font-black text-md mb-5 flex items-center gap-2" style={{color:'#0d9488'}}>
                <PlusCircle size={18} /> {selectedResId ? "예약 수정 (클릭해제 시 신규등록)" : "새 예약 등록"}
              </h4>
              {renderForm(true)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
