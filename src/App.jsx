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
  Search, Check, TableProperties, Lock, Phone, Settings, Download
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

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
  if (holidaySet.has(ns) && nxt.getDay() === 6) return true;
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

async function refreshHolidaysIfNeeded(db, currentRateConfig, setRateConfig, showMsg) {
  try {
    const metaRef = doc(db, 'config', 'holidayMeta');
    const metaSnap = await getDoc(metaRef);
    const now = Date.now();
    const lastUpdated = metaSnap.exists() ? (metaSnap.data().updatedAt || 0) : 0;
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

    if (now - lastUpdated < TWENTY_FOUR_HOURS) return;

    const thisYear = new Date().getFullYear();
    const nextYear = thisYear + 1;

    const [r1, r2] = await Promise.all([
      fetchHolidaysFromAPI(thisYear),
      fetchHolidaysFromAPI(nextYear),
    ]);

    const freshDates = [...new Set([...r1.dates, ...r2.dates])].sort();
    const freshNames = { ...r1.names, ...r2.names };

    const otherYears = (currentRateConfig.holidays || []).filter(h =>
      !h.startsWith(String(thisYear)) && !h.startsWith(String(nextYear))
    );
    const newHolidays = [...new Set([...otherYears, ...freshDates])].sort();

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
    console.warn('공휴일 API 갱신 실패:', err.message);
  }
}

// --- 2. 상수 (화사한 파스텔톤 컬러 적용) ---
const ROOMS = [
  { id:'Shell', name:'Shell (쉘)', color:'bg-rose-50/80 text-rose-600 border-rose-100', dot:'bg-rose-400' },
  { id:'Beach', name:'Beach (비치)', color:'bg-cyan-50/80 text-cyan-600 border-cyan-100', dot:'bg-cyan-400' },
  { id:'Pine', name:'Pine (파인)', color:'bg-teal-50/80 text-teal-600 border-teal-100', dot:'bg-teal-400' },
];
const PATHS = ['직접','네이버펜션','네이버플레이스','네이버지도','여기어때','떠나요','홈페이지'];

const INITIAL_DATA = [
  { date:'2026-03-25', room:'Shell', name:'테스트', phone:'01012345678', path:'직접', nights:1, price:100000, adults:2, kids:0 }
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
// 요금 설정 탭 (테마 색상 teal로 변경)
// ─────────────────────────────────────────
function SettingsTab({ rateConfig, onSave }) {
  const [cfg, setCfg] = React.useState(() => JSON.parse(JSON.stringify(rateConfig)));
  const [holidayInput, setHolidayInput] = React.useState('');
  const [dirty, setDirty] = React.useState(false);

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
        <h2 className="text-2xl font-black text-stone-800 flex items-center gap-2">
          <Settings size={22} className="text-teal-500" /> 요금 설정
        </h2>
        {dirty && (
          <button onClick={() => { onSave(cfg); setDirty(false); }}
            className="px-6 py-2.5 bg-teal-500 text-white font-bold rounded-xl shadow-lg hover:bg-teal-600 transition-all text-sm">
            저장
          </button>
        )}
      </div>

      {cfg.seasons.map((s, idx) => (
        <div key={s.id} className="bg-white/80 backdrop-blur-md p-6 rounded-[1.5rem] border border-stone-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-4">
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1 rounded-full text-xs font-bold
              ${s.id==='peak'?'bg-rose-50 text-rose-600':
                s.id==='pre1'||s.id==='pre2'?'bg-amber-50 text-amber-600':
                'bg-stone-100 text-stone-500'}`}>{s.label}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col">
              <label className="text-[10px] font-bold text-stone-400 mb-1">시작 (MM-DD)</label>
              <input value={s.start} onChange={e => updateSeason(idx,'start',e.target.value)}
                placeholder="MM-DD" maxLength={5}
                className="p-2.5 bg-stone-50 rounded-xl font-bold text-sm outline-none focus:ring-2 ring-teal-500/50" />
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] font-bold text-stone-400 mb-1">종료 (MM-DD)</label>
              <input value={s.end} onChange={e => updateSeason(idx,'end',e.target.value)}
                placeholder="MM-DD" maxLength={5}
                className="p-2.5 bg-stone-50 rounded-xl font-bold text-sm outline-none focus:ring-2 ring-teal-500/50" />
            </div>
          </div>
          {s.weekendSame ? (
            <div>
              <label className="text-[10px] font-bold text-stone-400 mb-2 block">단가 (평일=주말)</label>
              <div className="grid grid-cols-3 gap-2">
                {['Shell','Beach','Pine'].map(r => (
                  <div key={r} className="flex flex-col">
                    <label className="text-[10px] font-bold text-stone-500 mb-1">{r}</label>
                    <input type="number" value={s[r]} onChange={e => updateSeason(idx,r,e.target.value)}
                      className="p-2 bg-stone-50 rounded-xl font-bold text-sm text-center outline-none focus:ring-2 ring-teal-500/50" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {['Shell','Beach','Pine'].map(r => (
                <div key={r}>
                  <label className="text-[10px] font-bold text-stone-500 mb-1 block">{r}</label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col">
                      <label className="text-[10px] text-stone-400 mb-1">평일</label>
                      <input type="number" value={s[r+'_w']} onChange={e => updateSeason(idx, r+'_w', e.target.value)}
                        className="p-2 bg-stone-50 rounded-xl font-bold text-sm text-center outline-none focus:ring-2 ring-teal-500/50" />
                    </div>
                    <div className="flex flex-col">
                      <label className="text-[10px] text-stone-400 mb-1">주말</label>
                      <input type="number" value={s[r+'_wk']} onChange={e => updateSeason(idx, r+'_wk', e.target.value)}
                        className="p-2 bg-stone-50 rounded-xl font-bold text-sm text-center outline-none focus:ring-2 ring-teal-500/50" />
                    </div>
                  </div>
                  {s.beachFriSpecial !== undefined && r === 'Beach' && (
                    <div className="mt-1 flex flex-col">
                      <label className="text-[10px] text-cyan-600 mb-1">Beach 금요일 특가</label>
                      <input type="number" value={s.beachFriSpecial} onChange={e => updateSeason(idx,'beachFriSpecial',e.target.value)}
                        className="p-2 bg-cyan-50/50 border border-cyan-100 rounded-xl font-bold text-sm text-center outline-none focus:ring-2 ring-cyan-300" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="bg-white/80 backdrop-blur-md p-6 rounded-[1.5rem] border border-stone-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-4">
        <h3 className="font-black text-stone-800">공휴일 목록</h3>
        <div className="p-4 bg-teal-50/50 border border-teal-100 rounded-2xl">
          <p className="text-xs font-bold text-teal-700">자동 갱신 활성화됨</p>
          <p className="text-[11px] text-teal-500/80 mt-1">
            공공데이터포털 API 기반 · 앱 로드 시 24시간 주기로 당해·내년도 자동 갱신
          </p>
        </div>
        <div className="flex gap-2">
          <input value={holidayInput} onChange={e => setHolidayInput(e.target.value)}
            onKeyDown={e => e.key==='Enter' && addHoliday()}
            placeholder="YYYY-MM-DD 수동 추가" maxLength={10}
            className="flex-1 p-3 bg-stone-50 rounded-xl font-bold text-sm outline-none focus:ring-2 ring-teal-500/50" />
          <button onClick={addHoliday}
            className="px-4 py-3 bg-stone-800 text-white font-bold rounded-xl text-sm hover:bg-stone-700 transition-all">
            추가
          </button>
        </div>
        <div className="flex flex-wrap gap-2 max-h-52 overflow-y-auto">
          {cfg.holidays.map(h => (
            <span key={h} className="flex items-center gap-1 px-3 py-1.5 bg-stone-100 rounded-full text-xs font-medium text-stone-600">
              {h}
              <button onClick={() => removeHoliday(h)} className="text-rose-400 hover:text-rose-600 ml-1">×</button>
            </span>
          ))}
        </div>
      </div>

      {dirty && (
        <button onClick={() => { onSave(cfg); setDirty(false); }}
          className="w-full py-4 bg-teal-500 text-white font-bold rounded-2xl shadow-lg hover:bg-teal-600 transition-all">
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
  const [exitConfirm, setExitConfirm] = useState(false);
  const [selectedResId, setSelectedResId] = useState(null);

  // 다중 필터 검색 상태
  const [searchFilters, setSearchFilters] = useState({ text: '', room: 'ALL', startDate: '', endDate: '' });

  const [isManualPrice, setIsManualPrice] = useState(false);
  const [manualPrice, setManualPrice] = useState('');
  const [manualPriceMode, setManualPriceMode] = useState('total');
  const [roomTouched, setRoomTouched] = useState(false);
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
        let loadedCfg = DEFAULT_RATE_CONFIG;
        const cfgSnap = await getDocs(collection(db,'config'));
        cfgSnap.forEach(d => { if (d.id === 'rateConfig') loadedCfg = d.data(); });
        setRateConfig(loadedCfg);

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
    reservations.forEach(r => {
      if (!r.date || !r.room || !r.nights) return;
      const totalP = Number(r.price) || 0;
      const perNight = Math.round(totalP / r.nights);
      revenue += totalP;
      for (let i = 0; i < r.nights; i++) {
        const ds = addDays(r.date, i);
        const ym = ds.slice(0, 7);
        if (!monthlyMap[ym]) monthlyMap[ym] = { Shell:0, Beach:0, Pine:0, total:0 };
        monthlyMap[ym][r.room] += perNight;
        monthlyMap[ym].total += perNight;
      }
    });
    return { revenue, count:reservations.length, monthlyMap };
  }, [reservations]);

  // Recharts 데이터 가공
  const chartData = useMemo(() => {
    const data = [];
    for(let i=1; i<=12; i++) {
      const ym = `${viewDate.getFullYear()}-${String(i).padStart(2,'0')}`;
      const s = stats.monthlyMap[ym] || { Shell:0, Beach:0, Pine:0, total:0 };
      data.push({ name: `${i}월`, Shell: s.Shell, Beach: s.Beach, Pine: s.Pine });
    }
    return data;
  }, [stats, viewDate]);

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

  // 다중 필터링 로직
  const advancedFilteredReservations = useMemo(() => {
    return reservations.filter(r => {
      const s = searchFilters.text.toLowerCase();
      const matchText = !s || (r.name?.toLowerCase().includes(s) || r.phone?.includes(s));
      const matchRoom = searchFilters.room === 'ALL' || r.room === searchFilters.room;
      const matchStart = !searchFilters.startDate || r.date >= searchFilters.startDate;
      const matchEnd = !searchFilters.endDate || r.date <= searchFilters.endDate;
      return matchText && matchRoom && matchStart && matchEnd;
    }).sort((a,b) => b.date.localeCompare(a.date));
  }, [reservations, searchFilters]);

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

  // 캘린더 D&D 핸들러
  const handleDrop = async (e, targetDate) => {
    e.preventDefault();
    const resId = e.dataTransfer.getData('resId');
    if (!resId || !targetDate) return;

    const targetRes = reservations.find(r => r.id === resId);
    if (!targetRes || targetRes.date === targetDate) return;

    for (let i = 0; i < targetRes.nights; i++) {
      if (isRoomFull(targetRes.room, addDays(targetDate, i), resId)) {
        showMsg("이동할 날짜에 이미 예약된 객실이 있습니다.", "error");
        return;
      }
    }
    try {
      await updateDoc(doc(db, 'reservations', resId), { date: targetDate });
      showMsg("예약 날짜가 변경되었습니다.", "success");
    } catch (err) {
      showMsg("날짜 변경 실패", "error");
    }
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
      <div className="grid grid-cols-3 gap-2">
        {ROOMS.map(r => {
          const full = isRoomFull(r.id, formData.date, editTarget);
          return (
            <button key={r.id} type="button" disabled={full}
              onClick={() => { setFormData({ ...formData, room:r.id }); setRoomTouched(true); }}
              className={`p-3 rounded-xl font-bold border-2 transition-all flex flex-col items-center
                ${full ? 'bg-stone-50 border-stone-100 text-stone-300 opacity-50' :
                  formData.room===r.id ? 'bg-teal-500 text-white border-teal-500 shadow-md' :
                  'bg-white border-stone-100 text-stone-500 hover:border-teal-200'}`}>
              <span className="text-xs md:text-sm">{r.name}</span>
              {full && <span className="text-[10px] text-rose-400 font-bold mt-1">예약 마감</span>}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {!isModal && (
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-stone-400 ml-1 mb-1">체크인 날짜</label>
            <input type="date" value={formData.date}
              onChange={e => setFormData({ ...formData, date:e.target.value })}
              className="p-3 bg-stone-50 rounded-xl font-bold border-none outline-none focus:ring-2 ring-teal-500/50 text-sm" required />
          </div>
        )}
        <div className="flex flex-col">
          <label className="text-[10px] font-bold text-stone-400 ml-1 mb-1">숙박 일수</label>
          <select value={formData.nights}
            onChange={e => setFormData({ ...formData, nights:Number(e.target.value) })}
            className="p-3 bg-stone-50 rounded-xl font-bold border-none outline-none focus:ring-2 ring-teal-500/50 text-sm">
            {[1,2,3,4,5,6,7].map(n => <option key={n} value={n}>{n}박</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold text-stone-400 ml-1 mb-1">성함</label>
          <input type="text" placeholder="예약자명" value={formData.name}
            onChange={e => setFormData({ ...formData, name:e.target.value })}
            className="p-3 bg-stone-50 rounded-xl font-bold border-none outline-none focus:ring-2 ring-teal-500/50 text-sm" required />
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold text-stone-400 ml-1 mb-1">연락처</label>
          <input type="tel" placeholder="010-0000-0000" value={formatPhone(formData.phone)}
            onChange={handlePhoneChange}
            className="p-3 bg-stone-50 rounded-xl font-bold border-none outline-none focus:ring-2 ring-teal-500/50 text-sm" />
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold text-stone-400 ml-1 mb-1">예약 경로</label>
          <select value={formData.path}
            onChange={e => setFormData({ ...formData, path:e.target.value })}
            className="p-3 bg-stone-50 rounded-xl font-bold border-none outline-none focus:ring-2 ring-teal-500/50 text-sm">
            {PATHS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-stone-50 p-4 rounded-2xl space-y-3 border border-stone-100">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-stone-500 mb-1 ml-1">성인(8세~, 2만)</label>
            <input type="number" min="0" value={formData.adults}
              onChange={e => setFormData({ ...formData, adults:Number(e.target.value) })}
              className="p-2.5 rounded-xl border-none font-bold text-center text-sm" />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-stone-500 mb-1 ml-1">아동(~7세, 1.5만)</label>
            <input type="number" min="0" value={formData.kids}
              onChange={e => setFormData({ ...formData, kids:Number(e.target.value) })}
              className="p-2.5 rounded-xl border-none font-bold text-center text-sm" />
          </div>
        </div>
        <button type="button" onClick={() => setFormData({ ...formData, bbq:!formData.bbq })}
          className={`w-full p-2.5 rounded-xl font-bold border-2 text-xs transition-all
            ${formData.bbq ? 'bg-rose-500 text-white border-rose-500' : 'bg-white text-stone-400 border-stone-100'}`}>
          바베큐 그릴 (30,000원) {formData.bbq ? '신청완료' : '미신청'}
        </button>
      </div>

      <div className="space-y-2">
        {roomTouched && (
          <div className="px-1 flex items-center justify-between">
            <span className="text-xs font-bold text-stone-400">
              {isManualPrice ? '직접입력 요금' : '예정 요금'}
            </span>
            <span className="text-base font-black text-stone-800">
              ₩{(isManualPrice ? finalManualPrice : autoTotalPrice).toLocaleString()}
            </span>
          </div>
        )}

        {isManualPrice && (
          <div className="p-4 bg-amber-50/80 border-2 border-amber-200 rounded-2xl space-y-3">
            <div className="flex gap-1 bg-amber-100/50 rounded-xl p-1">
              <button type="button"
                onClick={() => { setManualPriceMode('total'); setManualPrice(''); }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all
                  ${manualPriceMode==='total' ? 'bg-white text-amber-700 shadow' : 'text-amber-600/60'}`}>
                합계 입력
              </button>
              <button type="button"
                onClick={() => { setManualPriceMode('pernight'); setManualPrice(''); }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all
                  ${manualPriceMode==='pernight' ? 'bg-white text-amber-700 shadow' : 'text-amber-600/60'}`}>
                1박 단가 입력
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={manualPrice}
                onChange={e => setManualPrice(e.target.value)}
                placeholder={manualPriceMode==='total'
                  ? `합계 금액 (${formData.nights}박)`
                  : '1박 단가'}
                className="flex-1 bg-white border-2 border-amber-200 rounded-xl p-3 outline-none font-bold text-amber-900 text-base placeholder-amber-300"
              />
              <span className="text-xs font-bold text-amber-600 shrink-0">원</span>
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={toggleManualPrice}
            className={`flex-1 py-3 rounded-xl font-bold text-xs transition-all border
              ${isManualPrice ? 'bg-amber-500 border-amber-400 text-white' : 'bg-stone-100 border-stone-200 text-stone-500 hover:bg-stone-200'}`}>
            {isManualPrice ? '✏️ 직접입력 중' : '가격 직접입력'}
          </button>
          <button type="submit"
            className="flex-1 py-3 bg-teal-500 rounded-xl font-bold text-sm text-white hover:bg-teal-600 transition-all shadow-lg">
            {editTarget ? "수정 완료" : "예약 저장"}
          </button>
        </div>
      </div>
    </form>
  );

  if (!isUnlocked) return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-sm bg-white/80 backdrop-blur-md p-10 rounded-[2.5rem] shadow-[0_8px_30px_rgb(0,0,0,0.06)] border border-white text-center">
        <div className="w-16 h-16 bg-teal-50 rounded-full flex items-center justify-center text-teal-500 mx-auto mb-6 shadow-sm">
          <Lock size={32} />
        </div>
        <h1 className="text-xl font-black text-stone-800 mb-6 tracking-tighter uppercase">Shell Beach Admin</h1>
        <form onSubmit={handleLogin} className="space-y-4">
          <input type="password" maxLength={4} value={pinInput}
            onChange={e => setPinInput(e.target.value)}
            className={`w-full p-4 text-center text-3xl font-black bg-stone-50 border-2 rounded-2xl outline-none transition-all
              ${pinError ? 'border-rose-400 focus:border-rose-500' : 'border-stone-100 focus:border-teal-500'}`}
            placeholder="PIN" autoFocus />
          {pinError && <p className="text-rose-500 text-xs font-bold">PIN이 올바르지 않습니다</p>}
          <button type="submit" className="w-full p-4 bg-teal-500 text-white font-bold rounded-2xl shadow-lg hover:bg-teal-600 transition-all">시스템 접속</button>
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
    <div className="flex flex-col md:flex-row h-screen bg-stone-50 font-sans text-stone-800 selection:bg-teal-200">
      {message && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[1000] px-6 py-2.5 rounded-full shadow-xl font-bold text-sm
          ${message.type==='success' ? 'bg-stone-800 text-white' : 'bg-rose-500 text-white'}`}>
          {message.text}
        </div>
      )}
      {exitConfirm && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[1000] px-6 py-2.5 rounded-full shadow-xl font-bold bg-amber-500 text-white text-sm">
          종료하시겠습니까? 한 번 더 누르면 종료됩니다
        </div>
      )}

      <nav className="hidden md:flex w-64 border-r border-stone-200/60 flex-col p-5 space-y-2 bg-white/60 backdrop-blur-xl z-20 shrink-0 shadow-[4px_0_24px_rgb(0,0,0,0.02)]">
        <div className="p-6 bg-gradient-to-br from-teal-400 to-teal-600 text-white rounded-[1.5rem] mb-4 shadow-lg shadow-teal-500/20">
          <BedDouble size={24} className="mb-3 opacity-90" />
          <h1 className="font-black text-xl uppercase tracking-tighter leading-none drop-shadow-sm">Shell<br />Beach</h1>
          <div className="mt-4 text-[10px] bg-black/10 px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1.5 w-fit backdrop-blur-sm border border-white/10">
            <Check size={10} className="text-teal-200" /> 실시간 동기화 중
          </div>
        </div>
        {NAV_ITEMS.map(item => (
          <button key={item.id} onClick={() => setActiveTab(item.id)}
            className={`flex items-center gap-3 p-3.5 rounded-xl font-medium transition-all
              ${activeTab===item.id ? 'bg-teal-50 text-teal-600 font-bold shadow-sm border border-teal-100/50' : 'text-stone-500 hover:bg-stone-100/80'}`}>
            <item.icon size={18} strokeWidth={activeTab===item.id?2.5:2} />
            <span className="text-sm">{item.label}</span>
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-auto relative bg-stone-50/50 pb-20 md:pb-0">
        {loading && (
          <div className="absolute inset-0 z-50 bg-stone-50/60 backdrop-blur-md flex items-center justify-center font-black text-teal-600/50 text-sm tracking-widest uppercase">
            Syncing...
          </div>
        )}
        <div className="p-4 md:p-8 max-w-[1300px] mx-auto">

          {activeTab==='calendar' && (
            <div className="space-y-4 md:space-y-6">
              <header className="flex flex-col md:flex-row justify-between items-center bg-white/80 backdrop-blur-md p-5 rounded-[1.5rem] shadow-[0_4px_20px_rgb(0,0,0,0.03)] border border-stone-100">
                <div className="flex items-center gap-4">
                  <div className="bg-teal-50 p-3 rounded-2xl text-teal-600 shadow-sm"><Calendar size={22} /></div>
                  <div>
                    <h2 className="text-2xl font-black text-stone-800">{viewDate.getFullYear()}년 {viewDate.getMonth()+1}월</h2>
                    <p className="text-sm font-bold text-teal-600 mt-1">
                      ₩{(stats.monthlyMap[`${viewDate.getFullYear()}-${String(viewDate.getMonth()+1).padStart(2,'0')}`]?.total||0).toLocaleString()}
                      <span className="text-stone-400 font-medium text-xs ml-1.5">월 매출</span>
                    </p>
                  </div>
                </div>
                <div className="flex gap-1.5 bg-stone-100/80 p-1.5 rounded-xl mt-4 md:mt-0">
                  <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth()-1,1))}
                    className="p-2 hover:bg-white rounded-lg shadow-sm text-stone-600"><ChevronLeft size={18} /></button>
                  <button onClick={() => setViewDate(new Date())}
                    className="px-4 font-bold text-xs text-teal-600 hover:bg-white rounded-lg transition-all">오늘</button>
                  <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth()+1,1))}
                    className="p-2 hover:bg-white rounded-lg shadow-sm text-stone-600"><ChevronRight size={18} /></button>
                </div>
              </header>

              <div className="grid grid-cols-7 bg-white/90 backdrop-blur-sm rounded-[1.5rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden border border-stone-200/60">
                {['일','월','화','수','목','금','토'].map((d,i) => (
                  <div key={d} className={`p-3 text-center text-xs font-bold border-b border-stone-100
                    ${i===0?'text-rose-500 bg-rose-50/30':i===6?'text-cyan-600 bg-cyan-50/30':'text-stone-400 bg-stone-50/50'}`}>{d}</div>
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

                  return (
                    <div key={i} 
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => handleDrop(e, dateStr)}
                      onClick={() => {
                        if (!dateStr) return;
                        setFormData({ date:dateStr, room:'Shell', name:'', phone:'010', adults:0, kids:0, bbq:false, nights:1, memo:'', path:'직접' });
                        setEditTarget(null); setSelectedResId(null);
                        setIsManualPrice(false); setManualPrice(''); setManualPriceMode('total'); setRoomTouched(false);
                        setIsModalOpen(true);
                      }}
                      className={`min-h-[90px] md:min-h-[120px] p-2 border-r border-b border-stone-100 cursor-pointer hover:bg-teal-50/30 transition-all
                        ${!dateStr?'bg-stone-50/30': isHoliday ? 'bg-rose-50/20' : 'bg-white'}`}>
                      {dateStr && (
                        <>
                          <span className={`text-xs font-bold
                            ${new Date(dateStr+'T00:00:00').getDay()===0||isHoliday?'text-rose-500':
                              new Date(dateStr+'T00:00:00').getDay()===6?'text-cyan-600':'text-stone-600'}`}>{day}</span>
                          {holidayName && (
                            <div className="text-[9px] font-bold text-rose-500 leading-tight truncate mt-0.5">{holidayName}</div>
                          )}
                          {!holidayName && isHoliday && (
                            <div className="text-[9px] font-bold text-rose-400 leading-tight mt-0.5">공휴일</div>
                          )}
                          <div className="mt-1 space-y-1">
                            {dayRes.map((r,idx) => (
                              <div key={idx} 
                                draggable
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  e.dataTransfer.setData('resId', r.id);
                                }}
                                className={`text-[10px] p-1.5 rounded-lg border font-bold truncate flex items-center gap-1.5 cursor-grab active:cursor-grabbing hover:brightness-95 transition-all
                                  ${ROOMS.find(rm=>rm.id===r.room)?.color||'bg-stone-50 text-stone-600 border-stone-200'}`}>
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${ROOMS.find(rm=>rm.id===r.room)?.dot||'bg-stone-300'}`}></div>
                                <span className="truncate">{r.name}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab==='add' && (
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="bg-white/90 backdrop-blur-md p-6 md:p-10 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-stone-100">
                <h2 className="text-2xl font-black text-stone-800 mb-8 border-b border-stone-100 pb-5 flex items-center gap-3">
                  <PlusCircle className="text-teal-500" /> 신규 예약 등록
                </h2>
                {renderForm(false)}
              </div>
            </div>
          )}

          {activeTab==='search' && (
            <div className="max-w-4xl mx-auto space-y-6">
              <h2 className="text-2xl font-black text-stone-800 mb-2">예약 내역 검색</h2>
              
              {/* 다중 필터 UI */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6 bg-white/80 p-4 rounded-[1.5rem] shadow-sm border border-stone-100">
                <div className="md:col-span-2 relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                  <input type="text" placeholder="성함 또는 연락처"
                    className="w-full p-3 pl-12 bg-stone-50 border border-stone-200 rounded-xl font-bold text-sm outline-none focus:border-teal-500 focus:bg-white transition-all"
                    value={searchFilters.text} onChange={e => setSearchFilters({...searchFilters, text: e.target.value})} />
                </div>
                <select value={searchFilters.room} onChange={e => setSearchFilters({...searchFilters, room: e.target.value})}
                  className="p-3 bg-stone-50 border border-stone-200 rounded-xl font-bold text-sm outline-none focus:border-teal-500 focus:bg-white transition-all text-stone-600">
                  <option value="ALL">모든 객실</option>
                  {ROOMS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <div className="flex items-center justify-between gap-1 bg-stone-50 border border-stone-200 rounded-xl px-2 focus-within:border-teal-500 focus-within:bg-white transition-all">
                  <input type="date" value={searchFilters.startDate} onChange={e => setSearchFilters({...searchFilters, startDate: e.target.value})} 
                    className="w-full text-xs font-bold outline-none bg-transparent text-stone-600" />
                  <span className="text-stone-300 font-black">-</span>
                  <input type="date" value={searchFilters.endDate} onChange={e => setSearchFilters({...searchFilters, endDate: e.target.value})} 
                    className="w-full text-xs font-bold outline-none bg-transparent text-stone-600" />
                </div>
              </div>

              <div className="space-y-3">
                {advancedFilteredReservations.length > 0 ? advancedFilteredReservations.map(r => (
                  <div key={r.id} className="bg-white/90 backdrop-blur-sm p-5 rounded-[1.5rem] border border-stone-100 flex flex-col md:flex-row justify-between md:items-center gap-4 shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] transition-all border-l-4 border-l-teal-500">
                    <div className="flex items-center gap-4">
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-xl shrink-0 shadow-sm
                        ${ROOMS.find(rm=>rm.id===r.room)?.color||'bg-stone-50 text-stone-400'}`}>
                        {r.room?r.room[0]:'?'}
                      </div>
                      <div>
                        <p className="text-lg font-black text-stone-800">{r.name}님
                          <span className="text-[10px] font-bold text-teal-600 ml-2 px-2 py-1 bg-teal-50 rounded-lg uppercase">{r.room}</span>
                        </p>
                        <p className="text-stone-500 font-medium mt-1 text-xs">{r.date} 입실 • <span className="font-bold text-stone-700">{r.nights}박</span> • {r.path||'-'}</p>
                        {r.phone && (
                          <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1.5 mt-2 text-stone-600 font-bold hover:text-teal-600 transition-colors bg-stone-50 hover:bg-teal-50 px-3 py-1 rounded-full text-[11px]">
                            <Phone size={11} /> {formatPhone(r.phone)}
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-between items-center md:flex-col md:items-end gap-2 border-t md:border-t-0 pt-4 md:pt-0 border-stone-100">
                      <p className="text-xl font-black text-stone-800">₩{(Number(r.price)||0).toLocaleString()}</p>
                      <div className="flex gap-2">
                        <button onClick={() => {
                          setFormData({ date:r.date, room:r.room, name:r.name, phone:r.phone||'010',
                            adults:r.adults||0, kids:r.kids||0, bbq:r.bbq||false,
                            nights:r.nights||1, memo:r.memo||'', path:r.path||'직접' });
                          setEditTarget(r.id); setIsManualPrice(false); setManualPrice('');
                          setManualPriceMode('total'); setRoomTouched(true); setIsModalOpen(true);
                        }} className="text-teal-600 font-bold text-[11px] px-3.5 py-2 bg-teal-50 rounded-xl hover:bg-teal-500 hover:text-white transition-all shadow-sm">수정</button>
                        <button onClick={() => handleDelete(r.id)}
                          className="text-rose-500 font-bold text-[11px] px-3.5 py-2 bg-rose-50 rounded-xl hover:bg-rose-500 hover:text-white transition-all shadow-sm">삭제</button>
                      </div>
                    </div>
                  </div>
                )) : <div className="p-16 text-center text-stone-400 font-bold text-sm bg-white/50 backdrop-blur-sm rounded-[2rem] border-2 border-dashed border-stone-200">검색 조건에 맞는 예약 내역이 없습니다.</div>}
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
                className="w-full flex items-center justify-center gap-2 p-4 bg-stone-800 text-white rounded-[1.5rem] font-bold hover:bg-stone-700 transition-all shadow-[0_8px_30px_rgb(0,0,0,0.08)]">
                <Download size={18} /> 전체 예약 CSV 내보내기 ({reservations.length}건)
              </button>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-center">
                <div className="bg-gradient-to-br from-teal-500 to-teal-700 p-8 rounded-[2rem] text-white shadow-lg shadow-teal-500/20 relative overflow-hidden">
                  <div className="absolute -right-4 -top-4 opacity-10"><Wallet size={120} /></div>
                  <p className="text-teal-100 font-bold text-xs tracking-wide">{viewDate.getFullYear()} 누적 총 매출</p>
                  <p className="text-4xl font-black mt-3">₩{Object.entries(stats.monthlyMap).filter(([k])=>k.startsWith(String(viewDate.getFullYear()))).reduce((s,[,v])=>s+v.total,0).toLocaleString()}</p>
                </div>
                <div className="bg-white/90 backdrop-blur-md p-8 rounded-[2rem] border border-stone-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden">
                  <div className="absolute -right-4 -top-4 opacity-[0.03] text-stone-900"><Users size={120} /></div>
                  <p className="text-stone-400 font-bold text-xs tracking-wide">총 예약 건수</p>
                  <p className="text-4xl font-black mt-3 text-stone-800">{stats.count}건</p>
                </div>
              </div>

              {/* Recharts 적용 차트 영역 */}
              <div className="bg-white/90 backdrop-blur-md p-6 md:p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-stone-100 mt-6">
                <div className="flex items-center justify-between mb-8">
                  <h4 className="font-black text-lg flex items-center gap-2 text-stone-800">
                    <BarChart3 className="text-teal-500" size={20} /> {viewDate.getFullYear()}년 객실별 매출 추이
                  </h4>
                  <div className="flex gap-1 bg-stone-50 p-1 rounded-xl border border-stone-100">
                    <button onClick={() => setViewDate(new Date(viewDate.getFullYear()-1, viewDate.getMonth(), 1))}
                      className="p-1.5 hover:bg-white rounded-lg shadow-sm text-stone-500"><ChevronLeft size={16} /></button>
                    <span className="px-4 text-sm font-black text-teal-600 self-center">{viewDate.getFullYear()}</span>
                    <button onClick={() => setViewDate(new Date(viewDate.getFullYear()+1, viewDate.getMonth(), 1))}
                      className="p-1.5 hover:bg-white rounded-lg shadow-sm text-stone-500"><ChevronRight size={16} /></button>
                  </div>
                </div>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <XAxis dataKey="name" tick={{fontSize: 11, fontWeight: 'bold', fill: '#78716c'}} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={(val) => `₩${(val/10000).toFixed(0)}만`} tick={{fontSize: 11, fill: '#a8a29e'}} axisLine={false} tickLine={false} />
                      <Tooltip 
                        formatter={(val) => `₩${val.toLocaleString()}`} 
                        cursor={{fill: '#f5f5f4'}}
                        contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 40px rgba(0,0,0,0.08)', fontWeight: 'bold' }}
                      />
                      <Legend wrapperStyle={{fontSize: '11px', fontWeight: 'bold', paddingTop: '20px'}} />
                      <Bar dataKey="Shell" name="Shell" stackId="a" fill="#fb7185" radius={[0,0,4,4]} maxBarSize={40} />
                      <Bar dataKey="Beach" name="Beach" stackId="a" fill="#22d3ee" maxBarSize={40} />
                      <Bar dataKey="Pine" name="Pine" stackId="a" fill="#2dd4bf" radius={[4,4,0,0]} maxBarSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
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

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/90 backdrop-blur-xl border-t border-stone-200/50 flex items-center justify-around px-2 py-2 shadow-[0_-10px_40px_rgba(0,0,0,0.04)] pb-safe">
        {NAV_ITEMS.map(item => (
          <button key={item.id} onClick={() => setActiveTab(item.id)}
            className={`flex flex-col items-center justify-center gap-1 flex-1 py-2 rounded-2xl transition-all
              ${activeTab===item.id?'text-teal-600 bg-teal-50':'text-stone-400 hover:bg-stone-50'}`}>
            <item.icon size={20} strokeWidth={activeTab===item.id?2.5:2} />
            <span className={`text-[10px] font-bold ${activeTab===item.id?'text-teal-600':'text-stone-400'}`}>{item.label}</span>
          </button>
        ))}
      </nav>

      {isModalOpen && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-md"
          onClick={resetModal}>
          <div className="bg-white/95 backdrop-blur-xl w-full max-w-xl rounded-[2.5rem] p-6 md:p-8 relative overflow-y-auto max-h-[92vh] shadow-[0_20px_60px_rgba(0,0,0,0.1)] border border-white"
            onClick={e => e.stopPropagation()}>
            <button onClick={resetModal}
              className="absolute top-6 right-6 p-2.5 bg-stone-100 text-stone-500 rounded-full hover:bg-rose-500 hover:text-white transition-all">
              <X size={18} strokeWidth={2.5} />
            </button>

            <div className="mb-6">
              <h3 className="text-3xl font-black text-stone-800 tracking-tight">{formData.date}</h3>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <p className="text-teal-600 font-bold text-[10px] tracking-widest uppercase">Daily Reservation View</p>
                {(() => {
                  const hName = rateConfig.holidayNames?.[formData.date];
                  const isHol = new Set(rateConfig.holidays||[]).has(formData.date);
                  if (!isHol) return null;
                  return (
                    <span className="px-2.5 py-0.5 bg-rose-50 text-rose-500 font-bold text-[10px] rounded-full border border-rose-100">
                      🎌 {hName || '공휴일'}
                    </span>
                  );
                })()}
              </div>
              {(reservationMap[formData.date]||[]).length > 0 && (
                <div className="mt-4 flex items-center gap-2 flex-wrap">
                  {selectedResId ? (
                    (() => {
                      const sel = (reservationMap[formData.date]||[]).find(r => r.id === selectedResId);
                      if (!sel) return null;
                      const nightIdx = Math.round((new Date(formData.date+'T00:00:00') - new Date(sel.date+'T00:00:00')) / 86400000);
                      const selExtra = (sel.adults||0)*20000 + (sel.kids||0)*15000 + (sel.bbq?30000:0);
                      const dayPrice = Math.round(((Number(sel.price)||0) - selExtra) / (sel.nights||1));
                      const extraCard = nightIdx === 0 ? selExtra : 0;
                      return (
                        <span className="px-3.5 py-1.5 bg-teal-500 text-white rounded-full text-xs font-bold shadow-sm">
                          {sel.name}님 · ₩{(dayPrice + extraCard).toLocaleString()} ({nightIdx+1}박째)
                        </span>
                      );
                    })()
                  ) : (
                    <span className="px-3.5 py-1.5 bg-stone-800 text-white rounded-full text-xs font-bold shadow-sm">
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
                      className="px-3 py-1.5 bg-stone-100 text-stone-600 rounded-full text-xs font-bold hover:bg-stone-200 transition-all">
                      전체보기
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="mb-8 space-y-3">
              {(reservationMap[formData.date]||[]).length > 0 ? (
                reservationMap[formData.date].map((r,i) => {
                  const isSelected = selectedResId === r.id;
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
                      className={`p-4 md:p-5 rounded-2xl cursor-pointer transition-all border 
                        ${isSelected ? 'ring-2 ring-teal-500 shadow-md border-transparent bg-white' : 'hover:shadow-md border-stone-100'}
                        ${!isSelected && (ROOMS.find(rm=>rm.id===r.room)?.color||'bg-stone-50 text-stone-600')}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-2.5">
                            <span className="font-black text-lg">{r.room}</span>
                            <span className="font-bold text-sm text-stone-700">{r.name}님</span>
                            <span className="font-black text-sm text-stone-900 bg-white/50 px-2 py-0.5 rounded-lg">
                              ₩{(() => {
                                const nightIdx = Math.round((new Date(formData.date+'T00:00:00') - new Date(r.date+'T00:00:00')) / 86400000);
                                const rExtra = (r.adults||0)*20000 + (r.kids||0)*15000 + (r.bbq?30000:0);
                                const dayPrice = Math.round(((Number(r.price)||0) - rExtra) / (r.nights||1));
                                const extra = nightIdx === 0 ? rExtra : 0;
                                return (dayPrice + extra).toLocaleString();
                              })()}
                            </span>
                          </div>
                          <div className="text-[11px] font-medium mt-2 opacity-80 flex items-center gap-2 flex-wrap">
                            {r.phone && (
                              <a href={`tel:${r.phone}`} onClick={e => e.stopPropagation()}
                                className="text-teal-700 font-bold flex items-center gap-1 hover:underline">
                                <Phone size={11}/>{formatPhone(r.phone)}
                              </a>
                            )}
                            <span className="font-bold">{r.nights}박</span>
                            {r.adults > 0 && <span>성인 {r.adults}</span>}
                            {r.kids > 0 && <span>아동 {r.kids}</span>}
                            {r.path && <span className="bg-white/80 px-2 py-0.5 rounded-full font-bold shadow-sm">{r.path}</span>}
                          </div>
                        </div>
                        {isSelected && (
                          <div className="flex gap-2 ml-2 shrink-0" onClick={e => e.stopPropagation()}>
                            <button onClick={() => handleDelete(r.id)}
                              className="text-rose-500 p-2 bg-rose-50 rounded-xl hover:bg-rose-500 hover:text-white transition-all shadow-sm">
                              <Trash2 size={18} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-8 bg-stone-50 rounded-2xl text-center font-bold text-stone-400 border-2 border-dashed border-stone-200 text-xs">
                  등록된 예약 내역이 없습니다.
                </div>
              )}
            </div>

            <div className="pt-6 border-t-2 border-stone-100">
              <h4 className="font-black text-md mb-5 text-teal-600 flex items-center gap-2">
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
