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

// --- 1. 요금 및 공휴일 로직 ---
const DEFAULT_RATE_CONFIG = {
  holidays: ['2026-01-01','2026-01-28','2026-01-29','2026-01-30','2026-03-01','2026-03-02','2026-05-05','2026-05-25','2026-06-03','2026-06-06','2026-06-08','2026-08-15','2026-08-17','2026-09-24','2026-09-25','2026-09-26','2026-09-28','2026-10-03','2026-10-05','2026-10-09','2026-12-25'],
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
  return dow === 6 || (holidaySet.has(ns)) || (dow === 5 && holidaySet.has(dateStr));
};

const getPricePerNightFn = (room, dateStr, rateConfig) => {
  const cfg = rateConfig || DEFAULT_RATE_CONFIG;
  const holidaySet = new Set(cfg.holidays || []);
  const [,m,d] = dateStr.split('-').map(Number);
  const mmdd = m * 100 + d;
  const isFri = new Date(dateStr + 'T00:00:00').getDay() === 5;
  const wk = isWeekendPriceFn(dateStr, holidaySet);

  for (const s of (cfg.seasons || [])) {
    const [sm, sd] = s.start.split('-').map(Number);
    const [em, ed] = s.end.split('-').map(Number);
    if (mmdd >= (sm*100+sd) && mmdd <= (em*100+ed)) {
      if (s.weekendSame) return s[room];
      if (s.beachFriSpecial && room === 'Beach' && isFri) return s.beachFriSpecial;
      return wk ? s[`${room}_wk`] : s[`${room}_w`];
    }
  }
  const off = cfg.seasons?.find(s => s.id === 'offpeak');
  return off ? (wk ? off[`${room}_wk`] : off[`${room}_w`]) : 0;
};

// --- 2. Firebase 설정 ---
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

// --- 3. 유틸리티 ---
const formatPhone = (p) => p ? p.replace(/[^0-9]/g,'').replace(/(\d{3})(\d{3,4})(\d{4})/, '$1-$2-$3') : '';
const getLocalTodayStr = () => new Date().toISOString().split('T')[0];
const addDays = (ds, n) => {
  const d = new Date(ds + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
};

const ROOMS = [
  { id:'Shell', name:'Shell', color:'bg-rose-50/80 text-rose-600 border-rose-100', dot:'bg-rose-400' },
  { id:'Beach', name:'Beach', color:'bg-cyan-50/80 text-cyan-600 border-cyan-100', dot:'bg-cyan-400' },
  { id:'Pine', name:'Pine', color:'bg-teal-50/80 text-teal-600 border-teal-100', dot:'bg-teal-400' },
];
const PATHS = ['직접','네이버펜션','네이버플레이스','네이버지도','여기어때','떠나요','홈페이지'];

// --- 4. 메인 컴포넌트 ---
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
  const [selectedResId, setSelectedResId] = useState(null);
  const [searchFilters, setSearchFilters] = useState({ text: '', room: 'ALL', startDate: '', endDate: '' });
  const [isManualPrice, setIsManualPrice] = useState(false);
  const [manualPrice, setManualPrice] = useState('');
  const [manualPriceMode, setManualPriceMode] = useState('total');
  const [roomTouched, setRoomTouched] = useState(false);
  const [formData, setFormData] = useState({ date: getLocalTodayStr(), room:'Shell', name:'', phone:'010', adults:0, kids:0, bbq:false, nights:1, memo:'', path:'직접' });

  const showMsg = (text, type) => { setMessage({ text, type }); setTimeout(() => setMessage(null), 3000); };

  const handleLogin = (e) => {
    e.preventDefault();
    if (pinInput === '9631') setIsUnlocked(true);
    else { setPinError(true); setPinInput(''); }
  };

  useEffect(() => {
    if (!isUnlocked) return;
    let unsub = null;
    const init = async () => {
      try {
        await signInAnonymously(auth);
        unsub = onSnapshot(collection(db,'reservations'), (s) => {
          setReservations(s.docs.map(d => ({ id:d.id, ...d.data() })));
          setLoading(false);
        });
        const cfgSnap = await getDoc(doc(db, 'config', 'rateConfig'));
        if (cfgSnap.exists()) setRateConfig(cfgSnap.data());
      } catch { setLoading(false); }
    };
    init();
    return () => unsub && unsub();
  }, [isUnlocked]);

  const reservationMap = useMemo(() => {
    const map = {};
    reservations.forEach(res => {
      for (let i = 0; i < (res.nights||1); i++) {
        const ds = addDays(res.date, i);
        if (!map[ds]) map[ds] = [];
        map[ds].push(res);
      }
    });
    return map;
  }, [reservations]);

  const isRoomFull = (roomType, dateStr, excludeId=null) => reservationMap[dateStr]?.some(r => r.room === roomType && r.id !== excludeId);

  const stats = useMemo(() => {
    const monthlyMap = {};
    reservations.forEach(r => {
      const totalP = Number(r.price) || 0;
      const perNight = Math.round(totalP / r.nights);
      for (let i = 0; i < r.nights; i++) {
        const ym = addDays(r.date, i).slice(0, 7);
        if (!monthlyMap[ym]) monthlyMap[ym] = { Shell:0, Beach:0, Pine:0, total:0 };
        monthlyMap[ym][r.room] += perNight;
        monthlyMap[ym].total += perNight;
      }
    });
    return { monthlyMap, count: reservations.length };
  }, [reservations]);

  const chartData = useMemo(() => {
    const data = [];
    for(let i=1; i<=12; i++) {
      const ym = `${viewDate.getFullYear()}-${String(i).padStart(2,'0')}`;
      const s = stats.monthlyMap[ym] || { Shell:0, Beach:0, Pine:0, total:0 };
      data.push({ name: `${i}월`, Shell: s.Shell, Beach: s.Beach, Pine: s.Pine });
    }
    return data;
  }, [stats, viewDate]);

  const getPricePerNight = (room, dateStr) => getPricePerNightFn(room, dateStr, rateConfig);

  const autoTotalPrice = useMemo(() => {
    let total = 0;
    for (let i = 0; i < formData.nights; i++) total += getPricePerNight(formData.room, addDays(formData.date, i));
    return total + (formData.adults*20000 + formData.kids*15000 + (formData.bbq?30000:0));
  }, [formData, rateConfig]);

  const finalPrice = isManualPrice ? (manualPriceMode === 'pernight' ? (Number(manualPrice)*formData.nights + (formData.adults*20000 + formData.kids*15000 + (formData.bbq?30000:0))) : Number(manualPrice)) : autoTotalPrice;

  const filteredRes = useMemo(() => {
    return reservations.filter(r => {
      const s = searchFilters.text.toLowerCase();
      const matchText = !s || (r.name?.toLowerCase().includes(s) || r.phone?.includes(s));
      const matchRoom = searchFilters.room === 'ALL' || r.room === searchFilters.room;
      const matchStart = !searchFilters.startDate || r.date >= searchFilters.startDate;
      const matchEnd = !searchFilters.endDate || r.date <= searchFilters.endDate;
      return matchText && matchRoom && matchStart && matchEnd;
    }).sort((a,b) => b.date.localeCompare(a.date));
  }, [reservations, searchFilters]);

  const resetModal = () => { setIsModalOpen(false); setEditTarget(null); setSelectedResId(null); setIsManualPrice(false); setManualPrice(''); setRoomTouched(false); };

  const handleSave = async (e) => {
    e.preventDefault();
    for (let i = 0; i < formData.nights; i++) {
      if (isRoomFull(formData.room, addDays(formData.date, i), editTarget)) {
        showMsg("해당 기간에 이미 예약이 있습니다.", "error"); return;
      }
    }
    try {
      if (editTarget) await updateDoc(doc(db,'reservations',editTarget), { ...formData, price: finalPrice });
      else await addDoc(collection(db,'reservations'), { ...formData, price: finalPrice, createdAt: serverTimestamp() });
      showMsg("저장 완료", "success"); resetModal(); if (activeTab === 'add') setActiveTab('calendar');
    } catch { showMsg("저장 실패", "error"); }
  };

  const handleDrop = async (e, targetDate) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('resId');
    const res = reservations.find(r => r.id === id);
    if (!res || res.date === targetDate) return;
    for (let i = 0; i < res.nights; i++) {
      if (isRoomFull(res.room, addDays(targetDate, i), id)) { showMsg("이동 불가: 이미 예약된 객실", "error"); return; }
    }
    await updateDoc(doc(db, 'reservations', id), { date: targetDate });
    showMsg("날짜 변경 완료", "success");
  };

  if (!isUnlocked) return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white/80 backdrop-blur-md p-10 rounded-[2.5rem] shadow-xl text-center">
        <Lock size={32} className="text-teal-500 mx-auto mb-6" />
        <h1 className="text-xl font-black text-stone-800 mb-6 uppercase">Shell Beach</h1>
        <form onSubmit={handleLogin} className="space-y-4">
          <input type="password" maxLength={4} value={pinInput} onChange={e => setPinInput(e.target.value)} className="w-full p-4 text-center text-3xl font-black bg-stone-50 border-2 rounded-2xl outline-none focus:border-teal-500" placeholder="PIN" autoFocus />
          <button type="submit" className="w-full p-4 bg-teal-500 text-white font-bold rounded-2xl">접속</button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col md:flex-row h-screen bg-stone-50 font-sans text-stone-800">
      {message && <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[1000] px-6 py-2.5 rounded-full shadow-xl font-bold text-sm ${message.type==='success' ? 'bg-stone-800 text-white' : 'bg-rose-500 text-white'}`}>{message.text}</div>}
      
      {/* 사이드바 네비게이션 */}
      <nav className="hidden md:flex w-64 border-r bg-white/60 p-5 flex-col space-y-2">
        <div className="p-6 bg-gradient-to-br from-teal-400 to-teal-600 text-white rounded-[1.5rem] mb-4">
          <BedDouble size={24} className="mb-3" />
          <h1 className="font-black text-xl leading-none">SHELL<br/>BEACH</h1>
        </div>
        {['calendar','add','search','stats','settings'].map(id => (
          <button key={id} onClick={() => setActiveTab(id)} className={`flex items-center gap-3 p-3.5 rounded-xl font-medium transition-all ${activeTab===id ? 'bg-teal-50 text-teal-600 font-bold' : 'text-stone-500 hover:bg-stone-100'}`}>
            {id==='calendar'&&<Calendar size={18}/>}{id==='add'&&<PlusCircle size={18}/>}{id==='search'&&<Search size={18}/>}{id==='stats'&&<BarChart3 size={18}/>}{id==='settings'&&<Settings size={18}/>}
            <span className="text-sm uppercase">{id}</span>
          </button>
        ))}
      </nav>

      {/* 메인 섹션 */}
      <main className="flex-1 overflow-auto p-4 md:p-8">
        {activeTab==='calendar' && (
          <div className="space-y-6">
            <header className="flex justify-between items-center bg-white p-5 rounded-[1.5rem] shadow-sm">
              <div className="flex items-center gap-4">
                <div className="bg-teal-50 p-3 rounded-2xl text-teal-600"><Calendar size={22} /></div>
                <div><h2 className="text-2xl font-black">{viewDate.getFullYear()}년 {viewDate.getMonth()+1}월</h2></div>
              </div>
              <div className="flex gap-1.5 bg-stone-100 p-1.5 rounded-xl">
                <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth()-1,1))} className="p-2 hover:bg-white rounded-lg"><ChevronLeft size={18} /></button>
                <button onClick={() => setViewDate(new Date())} className="px-4 font-bold text-xs text-teal-600">오늘</button>
                <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth()+1,1))} className="p-2 hover:bg-white rounded-lg"><ChevronRight size={18} /></button>
              </div>
            </header>
            <div className="grid grid-cols-7 bg-white rounded-[1.5rem] shadow-sm overflow-hidden border border-stone-100">
              {['일','월','화','수','목','금','토'].map((d,i) => <div key={d} className={`p-3 text-center text-xs font-bold border-b ${i===0?'text-rose-500':i===6?'text-cyan-600':'text-stone-400'}`}>{d}</div>)}
              {Array.from({length:42}).map((_,i) => {
                const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
                const day = i - firstDay + 1;
                const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth()+1, 0).getDate();
                const ds = day>0 && day<=daysInMonth ? `${viewDate.getFullYear()}-${String(viewDate.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}` : null;
                const resList = ds ? (reservationMap[ds]||[]) : [];
                return (
                  <div key={i} onDragOver={e=>e.preventDefault()} onDrop={e=>handleDrop(e, ds)} onClick={() => ds && (setFormData({...formData, date:ds}), setIsModalOpen(true))} className={`min-h-[100px] p-2 border-r border-b border-stone-50 cursor-pointer hover:bg-teal-50/30 ${!ds?'bg-stone-50/30':'bg-white'}`}>
                    {ds && <span className="text-xs font-bold">{day}</span>}
                    <div className="mt-1 space-y-1">
                      {resList.map((r,idx) => (
                        <div key={idx} draggable onDragStart={e=>{ e.stopPropagation(); e.dataTransfer.setData('resId', r.id); }} className={`text-[10px] p-1 rounded-lg border font-bold truncate ${ROOMS.find(rm=>rm.id===r.room)?.color}`}>
                          {r.name}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab==='stats' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-teal-500 p-8 rounded-[2rem] text-white shadow-lg">
                <p className="text-teal-100 text-xs font-bold">올해 누적 매출</p>
                <p className="text-3xl font-black mt-2">₩{Object.entries(stats.monthlyMap).filter(([k])=>k.startsWith(String(viewDate.getFullYear()))).reduce((s,[,v])=>s+v.total,0).toLocaleString()}</p>
              </div>
              <div className="bg-white p-8 rounded-[2rem] border shadow-sm">
                <p className="text-stone-400 text-xs font-bold">총 예약 건수</p>
                <p className="text-3xl font-black mt-2">{stats.count}건</p>
              </div>
            </div>
            <div className="bg-white p-6 rounded-[2rem] shadow-sm border">
              <h4 className="font-black mb-6 flex items-center gap-2"><BarChart3 size={20} className="text-teal-500" /> 객실별 매출 추이</h4>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <XAxis dataKey="name" interval={0} tick={{fontSize: 9, fontWeight: 'bold', fill: '#78716c'}} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={v => `${(v/10000).toFixed(0)}만`} tick={{fontSize: 10}} axisLine={false} tickLine={false} />
                    <Tooltip formatter={v => `₩${v.toLocaleString()}`} contentStyle={{borderRadius:'12px', border:'none'}} />
                    <Legend iconType="circle" />
                    <Bar dataKey="Shell" stackId="a" fill="#fb7185" radius={[0,0,4,4]} />
                    <Bar dataKey="Beach" stackId="a" fill="#22d3ee" />
                    <Bar dataKey="Pine" stackId="a" fill="#2dd4bf" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* 예약 등록 / 검색 / 설정 등 기타 탭 로직 생략 (기본 구조 동일) */}
        {activeTab === 'add' && (
           <div className="max-w-2xl mx-auto bg-white p-8 rounded-[2rem] shadow-sm">
              <h2 className="text-xl font-black mb-6">신규 예약 등록</h2>
              <form onSubmit={handleSave} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <input type="date" value={formData.date} onChange={e=>setFormData({...formData, date:e.target.value})} className="p-3 bg-stone-50 rounded-xl font-bold border-none" />
                  <select value={formData.nights} onChange={e=>setFormData({...formData, nights:Number(e.target.value)})} className="p-3 bg-stone-50 rounded-xl font-bold border-none">
                    {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}박</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {ROOMS.map(r => (
                    <button key={r.id} type="button" onClick={()=>setFormData({...formData, room:r.id})} className={`p-3 rounded-xl font-bold border-2 transition-all ${formData.room===r.id ? 'bg-teal-500 text-white border-teal-500' : 'bg-white border-stone-100 text-stone-400'}`}>{r.name}</button>
                  ))}
                </div>
                <input type="text" placeholder="예약자 성함" value={formData.name} onChange={e=>setFormData({...formData, name:e.target.value})} className="w-full p-3 bg-stone-50 rounded-xl font-bold border-none" required />
                <input type="tel" placeholder="연락처" value={formData.phone} onChange={e=>setFormData({...formData, phone:e.target.value})} className="w-full p-3 bg-stone-50 rounded-xl font-bold border-none" />
                <button type="submit" className="w-full p-4 bg-teal-500 text-white font-bold rounded-2xl shadow-lg mt-4">저장하기</button>
              </form>
           </div>
        )}

        {activeTab === 'search' && (
          <div className="max-w-4xl mx-auto space-y-4">
            <div className="flex gap-2 bg-white p-4 rounded-2xl shadow-sm border">
               <Search className="text-stone-400" />
               <input type="text" placeholder="이름 또는 연락처 검색" value={searchFilters.text} onChange={e=>setSearchFilters({...searchFilters, text:e.target.value})} className="flex-1 outline-none font-bold" />
            </div>
            <div className="space-y-3">
              {filteredRes.map(r => (
                <div key={r.id} className="bg-white p-5 rounded-2xl border-l-4 border-teal-500 shadow-sm flex justify-between items-center">
                  <div>
                    <p className="font-black text-lg">{r.name}님 <span className="text-xs bg-teal-50 text-teal-600 px-2 py-1 rounded-lg ml-2">{r.room}</span></p>
                    <p className="text-xs text-stone-400 mt-1">{r.date} 입실 • {r.nights}박</p>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-xl">₩{(r.price||0).toLocaleString()}</p>
                    <button onClick={()=>handleDelete(r.id)} className="text-rose-500 font-bold text-xs mt-2">삭제</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>

      {/* 모바일 하단 네비게이션 */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t p-2 flex justify-around items-center">
        {['calendar','add','search','stats'].map(id => (
          <button key={id} onClick={() => setActiveTab(id)} className={`flex flex-col items-center p-2 ${activeTab===id?'text-teal-600':'text-stone-300'}`}>
            {id==='calendar'&&<Calendar size={20}/>}{id==='add'&&<PlusCircle size={20}/>}{id==='search'&&<Search size={20}/>}{id==='stats'&&<BarChart3 size={20}/>}
            <span className="text-[10px] font-bold mt-1 uppercase">{id}</span>
          </button>
        ))}
      </nav>

      {/* 모달 창 */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[500] bg-stone-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={resetModal}>
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl relative" onClick={e=>e.stopPropagation()}>
            <button onClick={resetModal} className="absolute top-6 right-6 p-2 bg-stone-100 rounded-full text-stone-400"><X size={18}/></button>
            <h3 className="text-2xl font-black mb-6">{formData.date} 예약</h3>
            <form onSubmit={handleSave} className="space-y-4">
               <div className="grid grid-cols-3 gap-2">
                  {ROOMS.map(r => (
                    <button key={r.id} type="button" onClick={()=>setFormData({...formData, room:r.id})} className={`p-3 rounded-xl font-bold border-2 transition-all ${formData.room===r.id ? 'bg-teal-500 text-white border-teal-500' : 'bg-white border-stone-100 text-stone-400'}`}>{r.name}</button>
                  ))}
                </div>
                <input type="text" placeholder="예약자 성함" value={formData.name} onChange={e=>setFormData({...formData, name:e.target.value})} className="w-full p-3 bg-stone-50 rounded-xl font-bold border-none" required />
                <input type="tel" placeholder="연락처" value={formData.phone} onChange={e=>setFormData({...formData, phone:e.target.value})} className="w-full p-3 bg-stone-50 rounded-xl font-bold border-none" />
                <div className="flex justify-between items-center px-2 py-4 border-t mt-4">
                  <span className="font-bold text-stone-400">예상 요금</span>
                  <span className="text-xl font-black text-teal-600">₩{finalPrice.toLocaleString()}</span>
                </div>
                <button type="submit" className="w-full p-4 bg-teal-500 text-white font-bold rounded-2xl shadow-lg">예약 완료</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


