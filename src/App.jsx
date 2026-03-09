import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, onSnapshot, 
  serverTimestamp, deleteDoc, doc, getDocs
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, onAuthStateChanged 
} from 'firebase/auth';
import { 
  Calendar, PlusCircle, BarChart3, ChevronLeft, 
  ChevronRight, BedDouble, X, TrendingUp, Users, Wallet, Trash2, Search, Check, TableProperties, Lock
} from 'lucide-react';

// --- 1. 환경 설정 및 상수 ---
const PRICING = {
  low: { Shell: [100000, 120000], Beach: [180000, 220000], Pine: [220000, 400000] },
  high: { Shell: [120000, 140000], Beach: [220000, 250000], Pine: [250000, 450000] }
};

const ROOMS = [
  { id: 'Shell', name: 'Shell (쉘)', color: 'bg-rose-50 text-rose-700 border-rose-100', dot: 'bg-rose-500' },
  { id: 'Beach', name: 'Beach (비치)', color: 'bg-sky-50 text-sky-700 border-sky-100', dot: 'bg-sky-500' },
  { id: 'Pine', name: 'Pine (파인)', color: 'bg-emerald-50 text-emerald-700 border-emerald-100', dot: 'bg-emerald-500' }
];

const INITIAL_DATA = [
  { date: '2026-01-01', room: 'Shell', name: '염준돈', path: '여기어때', nights: 1, price: 120000 },
  { date: '2026-01-01', room: 'Pine', name: '손미향', path: '떠나요', nights: 1, price: 220000 }
];

// --- 2. 파이어베이스 초기화 (아래 객체를 본인 정보로 교체하십시오) ---
const firebaseConfig = {
  apiKey: "AIzaSyBaJNGRJJJxgW6eKsvloW8dAOK3afXBke8",
  authDomain: "shell-beach-admin.firebaseapp.com",
  projectId: "shell-beach-admin",
  storageBucket: "shell-beach-admin.firebasestorage.app",
  messagingSenderId: "1056075007903",
  appId: "1:1056075007903:web:4cd35e2f64792d47d81faa"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const displayPhone = (phone) => {
  if (!phone) return '연락처 없음';
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length === 8) {
    return `010-${digits.slice(0,4)}-${digits.slice(4)}`;
  }
  return phone; 
};

const getLocalTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function App() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);

  const [user, setUser] = useState(null);
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('calendar'); 
  const [viewDate, setViewDate] = useState(new Date());
  const [message, setMessage] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const [formData, setFormData] = useState({
    date: getLocalTodayStr(), room: 'Shell', name: '', phone: '', 
    adults: 0, kids: 0, bbq: false, nights: 1, memo: '', path: '직접'
  });

  useEffect(() => {
    if (sessionStorage.getItem('shellBeachUnlocked') === 'true') {
      setIsUnlocked(true);
    }
  }, []);

  const handleLogin = (e) => {
    e.preventDefault();
    if (pinInput === '9631') {
      sessionStorage.setItem('shellBeachUnlocked', 'true');
      setIsUnlocked(true);
      setPinError(false);
    } else {
      setPinError(true);
      setPinInput('');
    }
  };

  useEffect(() => {
    if (!isUnlocked) return;
    if (firebaseConfig.apiKey.includes("본인")) {
      setLoading(false);
      return; 
    }

    const initApp = async () => {
      try {
        const currentUser = (await signInAnonymously(auth)).user;
        setUser(currentUser);

        const colRef = collection(db, 'reservations');
        const snap = await getDocs(colRef);
        if (snap.empty) {
          for (const item of INITIAL_DATA) {
            await addDoc(colRef, { ...item, createdAt: serverTimestamp() });
          }
        }
      } catch (error) {
        console.error("Firebase Auth / Init Error:", error);
      }
    };
    initApp();
    
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, [isUnlocked]);

  useEffect(() => {
    if (!isUnlocked || !user || firebaseConfig.apiKey.includes("본인")) return;
    
    const q = collection(db, 'reservations');
    const unsubscribe = onSnapshot(q, (snap) => {
      setReservations(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (error) => {
      console.error("Firestore sync error", error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user, isUnlocked]);

  const reservationMap = useMemo(() => {
    const map = {};
    reservations.forEach(res => {
      if (!res.date) return;
      const [y, m, d] = res.date.split('-');
      const startDate = new Date(Number(y), Number(m) - 1, Number(d));
      
      for (let i = 0; i < (res.nights || 1); i++) {
        const targetDate = new Date(startDate);
        targetDate.setDate(startDate.getDate() + i);
        
        const ty = targetDate.getFullYear();
        const tm = String(targetDate.getMonth() + 1).padStart(2, '0');
        const td = String(targetDate.getDate()).padStart(2, '0');
        const dateStr = `${ty}-${tm}-${td}`;
        
        if (!map[dateStr]) map[dateStr] = [];
        map[dateStr].push(res);
      }
    });
    return map;
  }, [reservations]);

  const stats = useMemo(() => {
    let revenue = 0;
    const monthlyRevenue = Array(12).fill(0);
    const monthlyRoomStats = Array(12).fill(null).map(() => ({ Shell: 0, Beach: 0, Pine: 0, total: 0 }));
    
    const roomStats = {
      Shell: { revenue: 0, count: 0 },
      Beach: { revenue: 0, count: 0 },
      Pine: { revenue: 0, count: 0 }
    };

    reservations.forEach(r => {
      const price = Number(r.price) || 0;
      revenue += price;
      
      if (r.date) {
        const [y, m] = r.date.split('-');
        if (y === '2026') {
          const monthIdx = Number(m) - 1;
          monthlyRevenue[monthIdx] += price;
          
          if (r.room && monthlyRoomStats[monthIdx][r.room] !== undefined) {
            monthlyRoomStats[monthIdx][r.room] += price;
            monthlyRoomStats[monthIdx].total += price;
          }
        }
      }
      
      if (r.room && roomStats[r.room]) {
        roomStats[r.room].revenue += price;
        roomStats[r.room].count += 1;
      }
    });
    
    return { revenue, count: reservations.length, monthlyRevenue, roomStats, monthlyRoomStats };
  }, [reservations]);

  const totalPrice = useMemo(() => {
    if (!formData.date) return 0;
    const [y, m, d] = formData.date.split('-');
    const startDate = new Date(Number(y), Number(m) - 1, Number(d));
    const isHigh = startDate.getMonth() >= 6 && startDate.getMonth() <= 7; 
    
    let total = 0;
    for(let i=0; i < formData.nights; i++) {
        const curr = new Date(startDate);
        curr.setDate(startDate.getDate() + i);
        const isWeekend = curr.getDay() === 5 || curr.getDay() === 6; 
        const rates = isHigh ? PRICING.high[formData.room] : PRICING.low[formData.room];
        total += rates[isWeekend ? 1 : 0];
    }
    
    const extra = ((formData.adults * 20000) + (formData.kids * 15000)) * formData.nights + (formData.bbq ? 30000 : 0);
    return total + extra;
  }, [formData]);

  const filteredReservations = useMemo(() => {
    if (!searchTerm) return reservations;
    return reservations.filter(r => 
      r.name?.includes(searchTerm) || r.phone?.includes(searchTerm)
    );
  }, [reservations, searchTerm]);

  const showMsg = (text, type) => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleDateClick = (dateStr) => {
    setFormData({ ...formData, date: dateStr, name: '', phone: '', adults: 0, kids: 0, bbq: false, nights: 1 });
    setIsModalOpen(true);
  };

  const handlePhoneChange = (e) => {
    const val = e.target.value.replace(/[^0-9]/g, '');
    if (val.length <= 8) {
      setFormData({...formData, phone: val});
    }
  };

  const formatPhoneInput = (phoneStr) => {
    if (!phoneStr) return '';
    if (phoneStr.length <= 4) return phoneStr;
    return `${phoneStr.slice(0, 4)}-${phoneStr.slice(4)}`;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!user) {
      showMsg("인증 정보가 없습니다. Firebase 설정을 확인하세요.", "error");
      return;
    }
    try {
      const col = collection(db, 'reservations');
      await addDoc(col, { ...formData, price: totalPrice, createdAt: serverTimestamp() });
      showMsg("예약이 정상적으로 저장되었습니다.", "success");
      setIsModalOpen(false);
      
      if(activeTab === 'add') setActiveTab('calendar');
    } catch (e) { showMsg("저장에 실패했습니다.", "error"); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("이 예약을 정말 삭제하시겠습니까?")) return;
    await deleteDoc(doc(db, 'reservations', id));
    showMsg("삭제가 완료되었습니다.", "success");
  };

  const handleModalBackdropClick = (e) => {
    if (e.target === e.currentTarget) setIsModalOpen(false);
  };

  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 selection:bg-blue-500/30">
        <div className="w-full max-w-sm bg-white p-8 md:p-10 rounded-[2.5rem] shadow-2xl flex flex-col items-center animate-in zoom-in-95 duration-300">
          <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center text-blue-600 mb-6 shadow-inner">
            <Lock size={36} strokeWidth={2.5} />
          </div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight text-center">Shell Beach<br/>관리자 로그인</h1>
          <p className="text-slate-400 font-bold text-sm mt-2 mb-8 text-center">액세스 핀 번호를 입력하세요</p>
          
          <form onSubmit={handleLogin} className="w-full space-y-4">
            <div>
              <input 
                type="password" 
                maxLength={4}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                className={`w-full p-4 text-center text-3xl tracking-[1em] font-black bg-slate-50 border-2 rounded-2xl outline-none transition-all focus:bg-white
                  ${pinError ? 'border-rose-500 text-rose-500 animate-shake focus:border-rose-500 focus:ring-4 ring-rose-500/20' : 'border-slate-100 text-slate-700 focus:border-blue-500 focus:ring-4 ring-blue-500/20'}`}
                placeholder="••••"
                autoFocus
              />
              {pinError && <p className="text-rose-500 text-xs font-bold text-center mt-3">비밀번호가 일치하지 않습니다.</p>}
            </div>
            <button 
              type="submit" 
              className="w-full p-4 mt-2 bg-blue-600 text-white font-black rounded-2xl hover:bg-blue-700 active:scale-[0.98] transition-all shadow-lg shadow-blue-600/30"
            >
              시스템 접속
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (firebaseConfig.apiKey.includes("본인")) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-slate-50 text-slate-600 text-center p-6">
        <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-200 max-w-md w-full">
          <h1 className="text-2xl font-black mb-4 text-rose-500">DB 연동 필요</h1>
          <p className="font-bold text-sm mb-6">코드 상단 `firebaseConfig` 영역에 본인의 프로젝트 정보를 입력해야 시스템이 정상 작동합니다.</p>
        </div>
      </div>
    );
  }

  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-slate-50 font-black text-slate-400 animate-pulse uppercase tracking-widest text-sm md:text-base">
      데이터베이스 동기화 중...
    </div>
  );

  const todayStr = getLocalTodayStr();

  const renderReservationForm = (isModal = false) => (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="grid grid-cols-3 gap-2 md:gap-3">
        {ROOMS.map(r => {
          const isFull = (reservationMap[formData.date] || []).some(res => res.room === r.id);
          return (
            <button key={r.id} type="button" disabled={isFull} onClick={() => setFormData({...formData, room: r.id})} 
              className={`p-3 md:p-5 rounded-2xl font-black border-2 transition-all text-xs md:text-sm shadow-sm
              ${isFull ? 'opacity-20 grayscale cursor-not-allowed border-slate-200' : formData.room === r.id ? 'bg-blue-600 text-white border-blue-600 scale-105 shadow-md' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 hover:border-blue-200'}`}>
              {r.name} {isFull && '(마감)'}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {!isModal && (
          <div className="flex flex-col">
            <label className="text-xs font-bold text-slate-500 ml-2 mb-1">체크인 날짜</label>
            <input type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-lg outline-none focus:ring-2 ring-blue-500" required />
          </div>
        )}
        <div className="flex flex-col">
          <label className="text-xs font-bold text-slate-500 ml-2 mb-1">숙박 일수</label>
          <select value={formData.nights} onChange={e => setFormData({...formData, nights: Number(e.target.value)})} className="p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-lg outline-none focus:ring-2 ring-blue-500">
            {[1,2,3,4,5,6,7].map(n => <option key={n} value={n}>{n}박 숙박</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-bold text-slate-500 ml-2 mb-1">예약자 성함</label>
          <input type="text" placeholder="홍길동" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-lg outline-none focus:ring-2 ring-blue-500" required />
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-bold text-slate-500 ml-2 mb-1">연락처 (가운데/뒷자리 8자)</label>
          <input type="tel" placeholder="1234-5678" value={formatPhoneInput(formData.phone)} onChange={handlePhoneChange} className="p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-lg outline-none focus:ring-2 ring-blue-500" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 md:gap-4 bg-blue-50/50 p-4 rounded-3xl border border-blue-100">
          <div className="flex flex-col">
            <label className="text-[10px] md:text-xs font-bold text-slate-600 mb-2 text-center">성인(8세~)<br/><span className="text-blue-600">+20,000원</span></label>
            <input type="number" min="0" placeholder="0명" value={formData.adults || ''} onChange={e => setFormData({...formData, adults: Number(e.target.value)})} className="p-3 text-center rounded-xl font-bold border border-white outline-none focus:ring-2 ring-blue-300 shadow-inner bg-white" />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] md:text-xs font-bold text-slate-600 mb-2 text-center">아동(~7세)<br/><span className="text-blue-600">+15,000원</span></label>
            <input type="number" min="0" placeholder="0명" value={formData.kids || ''} onChange={e => setFormData({...formData, kids: Number(e.target.value)})} className="p-3 text-center rounded-xl font-bold border border-white outline-none focus:ring-2 ring-blue-300 shadow-inner bg-white" />
          </div>
          <div className="flex flex-col justify-end">
            <label className="text-[10px] md:text-xs font-bold text-slate-600 mb-2 text-center">바베큐 세팅<br/><span className="text-rose-500">+30,000원</span></label>
            <button 
              type="button" 
              onClick={() => setFormData({...formData, bbq: !formData.bbq})}
              className={`p-3 rounded-xl font-bold border transition-all flex items-center justify-center gap-1
                ${formData.bbq ? 'bg-rose-500 text-white border-rose-600 shadow-inner' : 'bg-white text-slate-400 border-white hover:bg-rose-50 shadow-sm'}`}
            >
              {formData.bbq ? <><Check size={16}/> 신청 (O)</> : '미신청 (X)'}
            </button>
          </div>
      </div>

      <div className="p-6 md:p-8 bg-slate-900 rounded-[2rem] text-white flex flex-col md:flex-row justify-between items-center shadow-2xl shadow-slate-900/20 gap-6 mt-4">
        <div className="text-center md:text-left">
          <p className="text-xs text-slate-400 font-bold mb-1">총 예상 결제 금액</p>
          <p className="text-3xl md:text-4xl font-black text-blue-400 tracking-tighter">₩{totalPrice.toLocaleString()}</p>
        </div>
        <button type="submit" className="w-full md:w-auto px-10 py-4 bg-blue-600 rounded-2xl font-black text-lg hover:bg-blue-500 active:scale-95 transition-all shadow-md">예약 등록하기</button>
      </div>
    </form>
  );

  return (
    <div className="flex flex-col md:flex-row h-screen bg-slate-50 text-slate-900 overflow-hidden font-sans">
      
      {message && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[1000] px-8 py-3 rounded-full shadow-2xl animate-in slide-in-from-top-4 text-sm md:text-base ${message.type === 'success' ? 'bg-slate-900 text-white' : 'bg-rose-600 text-white'}`}>
          <span className="font-bold">{message.text}</span>
        </div>
      )}

      {/* Sidebar Navigation */}
      <nav className="w-full md:w-72 border-r border-slate-200 flex md:flex-col p-4 md:p-6 space-x-2 md:space-x-0 md:space-y-3 bg-white shadow-xl z-20 shrink-0 overflow-x-auto">
        <div className="hidden md:flex flex-col p-8 bg-gradient-to-br from-blue-600 to-blue-800 text-white rounded-[2rem] mb-6 shadow-xl shadow-blue-100/50">
          <BedDouble size={32} className="mb-4" />
          <h1 className="font-black text-2xl leading-none italic tracking-tighter uppercase">Shell<br/>Beach</h1>
          <div className="h-1 w-10 bg-white/30 mt-5 rounded-full"></div>
          <p className="text-[10px] mt-4 font-bold opacity-70">통합 관리 시스템 v8</p>
        </div>

        {[
          { id: 'calendar', icon: Calendar, label: '예약 현황판' },
          { id: 'add', icon: PlusCircle, label: '예약 등록' },
          { id: 'search', icon: Search, label: '예약 검색' },
          { id: 'stats', icon: BarChart3, label: '경영 리포트' }
        ].map(item => (
          <button key={item.id} onClick={() => setActiveTab(item.id)}
            className={`flex-1 md:flex-none flex items-center justify-center md:justify-start gap-4 p-4 rounded-2xl transition-all whitespace-nowrap ${activeTab === item.id ? 'bg-slate-900 text-white shadow-lg md:translate-x-1' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}>
            <item.icon size={20} /> <span className="text-sm font-bold">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 overflow-auto bg-slate-50 w-full relative">
        {activeTab === 'calendar' && (
          <div className="p-4 md:p-8 max-w-[1400px] mx-auto space-y-6 animate-in fade-in duration-500">
            <header className="flex flex-col md:flex-row justify-between items-center bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-slate-200/60">
              <div className="flex items-center gap-5">
                <div className="bg-blue-50 p-3 rounded-2xl text-blue-600"><Calendar size={26}/></div>
                <h2 className="text-2xl md:text-3xl font-black tracking-tight">{viewDate.getFullYear()}년 {viewDate.getMonth() + 1}월</h2>
              </div>
              <div className="flex gap-2 mt-4 md:mt-0 bg-slate-50 p-2 rounded-2xl border border-slate-100">
                <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))} className="p-3 hover:bg-white rounded-xl transition-all shadow-sm text-slate-600"><ChevronLeft size={20}/></button>
                <button onClick={() => setViewDate(new Date())} className="px-6 font-bold text-sm text-blue-600 hover:bg-blue-50 rounded-xl transition-colors">오늘</button>
                <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))} className="p-3 hover:bg-white rounded-xl transition-all shadow-sm text-slate-600"><ChevronRight size={20}/></button>
              </div>
            </header>
            
            <div className="overflow-x-auto bg-white rounded-[2rem] shadow-xl border border-slate-200/60">
              <div className="min-w-[700px] grid grid-cols-7">
                {['일','월','화','수','목','금','토'].map((d, i) => (
                  <div key={d} className={`p-4 text-center text-xs font-black border-b border-slate-100 ${i === 0 ? 'text-rose-500 bg-rose-50/50' : i === 6 ? 'text-blue-500 bg-blue-50/50' : 'text-slate-400 bg-slate-50/50'}`}>{d}</div>
                ))}
                {Array.from({ length: 42 }).map((_, i) => {
                  const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
                  const day = i - firstDay + 1;
                  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
                  const dateStr = day > 0 && day <= daysInMonth ? `${viewDate.getFullYear()}-${String(viewDate.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}` : null;
                  const dayRes = dateStr ? (reservationMap[dateStr] || []) : [];
                  const isToday = dateStr === todayStr;
                  
                  return (
                    <div key={i} onClick={() => dateStr && handleDateClick(dateStr)}
                      className={`min-h-[120px] md:min-h-[140px] p-3 md:p-4 border-r border-b border-slate-100 last:border-r-0 transition-colors cursor-pointer group 
                        ${!dateStr ? 'bg-slate-50/50' : isToday ? 'bg-blue-50/30 ring-2 ring-inset ring-blue-400 hover:bg-blue-50/60' : 'bg-white hover:bg-slate-50'}`}>
                      {dateStr && (
                        <>
                          <div className="flex justify-between items-start mb-2">
                            <span className={`text-base md:text-lg font-black flex items-center justify-center w-7 h-7 rounded-full
                              ${isToday ? 'bg-blue-600 text-white' : new Date(dateStr).getDay() === 0 ? 'text-rose-500' : new Date(dateStr).getDay() === 6 ? 'text-blue-500' : 'text-slate-600'}`}>{day}</span>
                            {dayRes.length > 0 && <div className="w-2 h-2 rounded-full bg-blue-500 shadow-md shadow-blue-300"></div>}
                          </div>
                          <div className="space-y-1">
                            {dayRes.map(r => (
                              <div key={`${r.id}-${dateStr}`} className={`text-[10px] p-2 rounded-lg border font-bold truncate flex items-center gap-1.5 ${ROOMS.find(rm => rm.id === r.room)?.color}`}>
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ROOMS.find(rm => rm.id === r.room)?.dot}`}></span>
                                {r.name} {r.nights > 1 && `(${r.nights}박)`}
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
          </div>
        )}

        {/* 1. 신규 예약 등록 탭 */}
        {activeTab === 'add' && (
          <div className="p-4 md:p-10 max-w-4xl mx-auto space-y-8 animate-in slide-in-from-bottom-4">
             <div className="bg-white p-6 md:p-10 rounded-[2.5rem] shadow-xl border border-slate-200/60">
                <div className="flex items-center gap-4 border-b border-slate-100 pb-6 mb-8">
                  <div className="p-3 bg-blue-100 text-blue-600 rounded-xl"><PlusCircle size={28}/></div>
                  <h2 className="text-2xl md:text-3xl font-black">신규 예약 등록</h2>
                </div>
                {renderReservationForm(false)}
             </div>
          </div>
        )}

        {/* 2. 예약 내역 검색 */}
        {activeTab === 'search' && (
          <div className="p-4 md:p-10 max-w-4xl mx-auto space-y-6 animate-in slide-in-from-bottom-4">
            <h2 className="text-2xl md:text-3xl font-black mb-4">예약 내역 검색</h2>
            <div className="relative">
              <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400" size={22} />
              <input 
                type="text" 
                placeholder="예약자 성함 또는 연락처(뒷자리) 입력..." 
                className="w-full p-6 pl-16 bg-white border border-slate-200/80 rounded-3xl shadow-md text-lg font-bold outline-none focus:ring-2 ring-blue-500 transition-all"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            
            <div className="space-y-4">
              {filteredReservations.length > 0 ? (
                filteredReservations.map(r => (
                  <div key={r.id} className="bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between md:items-center gap-4 hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-5">
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-xl shadow-inner shrink-0 ${ROOMS.find(rm => rm.id === r.room)?.color}`}>
                        {r.room[0]}
                      </div>
                      <div>
                        <p className="text-xl md:text-2xl font-black">{r.name}님 <span className="text-slate-400 font-bold ml-2 text-sm border-l-2 border-slate-200 pl-2">{r.room}</span></p>
                        <p className="text-sm font-bold text-slate-500 mt-1">{r.date} 입실 • {r.nights}박 • {displayPhone(r.phone)}</p>
                      </div>
                    </div>
                    <div className="flex flex-row md:flex-col justify-between items-center md:items-end border-t md:border-t-0 border-slate-100 pt-4 md:pt-0">
                       <p className="text-lg md:text-xl font-black text-blue-600">₩{(Number(r.price)||0).toLocaleString()}</p>
                       <button onClick={() => handleDelete(r.id)} className="md:mt-2 text-rose-500 bg-rose-50 px-4 py-2 rounded-lg font-bold text-xs hover:bg-rose-500 hover:text-white transition-colors">예약 취소</button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-16 text-center text-slate-400 font-bold text-lg bg-white rounded-3xl border-2 border-dashed border-slate-200">일치하는 예약 내역이 없습니다.</div>
              )}
            </div>
          </div>
        )}

        {/* 3. 경영 리포트 탭 */}
        {activeTab === 'stats' && (
          <div className="p-4 md:p-10 max-w-6xl mx-auto space-y-8 animate-in fade-in">
             <div className="flex items-center gap-4 bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <div className="p-3 bg-blue-100 rounded-xl"><TrendingUp className="text-blue-600" size={28} /></div>
                <h2 className="text-2xl md:text-3xl font-black">경영 통계 리포트 (2026년 기준)</h2>
             </div>
             
             {/* 통합 요약 */}
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
               <div className="bg-gradient-to-br from-slate-900 to-slate-800 p-8 rounded-3xl shadow-lg relative overflow-hidden group text-white">
                  <div className="absolute -right-4 -top-4 opacity-10 group-hover:scale-110 transition-transform"><Wallet size={100} /></div>
                  <p className="text-blue-300 font-bold text-sm">총 누적 매출액</p>
                  <p className="text-3xl md:text-4xl font-black mt-4">₩{stats.revenue.toLocaleString()}</p>
               </div>
               <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200 relative overflow-hidden group">
                  <div className="absolute -right-4 -top-4 opacity-5 group-hover:scale-110 transition-transform"><Users size={100} /></div>
                  <p className="text-slate-500 font-bold text-sm">총 예약 건수</p>
                  <p className="text-3xl md:text-4xl font-black text-slate-800 mt-4">{stats.count}건</p>
               </div>
               <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200 relative overflow-hidden group">
                  <div className="absolute -right-4 -top-4 opacity-5 group-hover:scale-110 transition-transform"><BarChart3 size={100} /></div>
                  <p className="text-slate-500 font-bold text-sm">평균 객단가 (1건당)</p>
                  <p className="text-3xl md:text-4xl font-black text-blue-600 mt-4">₩{(stats.count ? Math.round(stats.revenue/stats.count) : 0).toLocaleString()}</p>
               </div>
             </div>

             {/* 객실별/월별 상세 테이블 */}
             <div className="bg-white p-6 md:p-10 rounded-[2.5rem] shadow-sm border border-slate-200 overflow-x-auto">
               <h4 className="font-black text-xl mb-6 flex items-center gap-2"><TableProperties size={20}/> 객실별 · 월별 상세 매출</h4>
               <table className="w-full text-left min-w-[700px]">
                 <thead>
                   <tr className="border-b-2 border-slate-100 text-slate-400 text-sm">
                     <th className="py-4 pl-4">구분 (월)</th>
                     <th className="py-4 text-rose-500">Shell (쉘)</th>
                     <th className="py-4 text-sky-500">Beach (비치)</th>
                     <th className="py-4 text-emerald-500">Pine (파인)</th>
                     <th className="py-4 text-slate-900 pr-4">월간 총 매출</th>
                   </tr>
                 </thead>
                 <tbody>
                   {stats.monthlyRoomStats.map((stat, i) => {
                     const opacityClass = stat.total === 0 ? "opacity-30" : "";
                     return (
                       <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${opacityClass}`}>
                         <td className="py-4 pl-4 font-bold text-slate-600 bg-slate-50/50 rounded-l-2xl">{i + 1}월</td>
                         <td className="py-4 font-bold">₩{stat.Shell.toLocaleString()}</td>
                         <td className="py-4 font-bold">₩{stat.Beach.toLocaleString()}</td>
                         <td className="py-4 font-bold">₩{stat.Pine.toLocaleString()}</td>
                         <td className="py-4 font-black text-blue-600 pr-4 bg-slate-50/50 rounded-r-2xl">₩{stat.total.toLocaleString()}</td>
                       </tr>
                     );
                   })}
                 </tbody>
               </table>
             </div>

             {/* 월별 그래프 */}
             <div className="bg-white p-6 md:p-10 rounded-[2.5rem] shadow-sm border border-slate-200 overflow-x-auto">
               <h4 className="font-black text-xl mb-8">월별 총 매출 트렌드</h4>
               <div className="flex items-end gap-3 md:gap-5 h-64 border-b-2 border-slate-100 pb-4 min-w-[500px] mt-10">
                 {stats.monthlyRevenue.map((val, i) => {
                   const max = Math.max(...stats.monthlyRevenue, 100000);
                   const height = (val / max) * 100;
                   return (
                     <div key={i} className="flex-1 flex flex-col items-center gap-3 group">
                       <div className="w-full bg-blue-500 rounded-t-xl hover:bg-slate-800 transition-all cursor-pointer relative shadow-sm" style={{ height: `${height}%` }}>
                          <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-3 py-1.5 rounded-lg text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity shadow-lg whitespace-nowrap z-10 pointer-events-none">₩{val.toLocaleString()}</div>
                       </div>
                       <span className="text-xs font-bold text-slate-500">{i + 1}월</span>
                     </div>
                   );
                 })}
               </div>
             </div>
          </div>
        )}
      </main>

      {/* 4. Modal Popup */}
      {isModalOpen && (
        <div 
          className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={handleModalBackdropClick} 
        >
          <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl p-6 md:p-10 relative overflow-y-auto max-h-[95vh] animate-in zoom-in-95 duration-200"
               onClick={e => e.stopPropagation()} 
          >
            <button onClick={() => setIsModalOpen(false)} className="absolute top-6 right-6 p-3 bg-slate-100 text-slate-500 rounded-full hover:bg-slate-200 transition-all"><X size={20} /></button>
            
            <div className="mb-8 border-b border-slate-100 pb-4">
              <h3 className="text-2xl md:text-3xl font-black">해당 일자 현황</h3>
              <p className="text-blue-600 font-bold text-lg mt-1">{formData.date}</p>
            </div>

            <div className="mb-10 space-y-3">
              <h4 className="text-sm font-bold text-slate-400 mb-3 flex items-center gap-2"><BedDouble size={16}/> 현재 예약된 객실</h4>
              {(reservationMap[formData.date] || []).length > 0 ? (
                reservationMap[formData.date].map(r => (
                  <div key={r.id} className={`p-5 rounded-2xl border flex flex-row justify-between items-center gap-4 shadow-sm ${ROOMS.find(rm => rm.id === r.room)?.color}`}>
                    <div>
                       <p className="font-black text-lg md:text-xl">{r.room} <span className="text-sm opacity-60 ml-1">| {r.name}님</span></p>
                       <p className="text-xs font-bold opacity-70 mt-1">{displayPhone(r.phone)} • {r.nights}박</p>
                    </div>
                    <button onClick={() => handleDelete(r.id)} className="p-3 bg-white/70 text-rose-500 rounded-xl hover:bg-rose-500 hover:text-white transition-all shadow-sm shrink-0 border border-rose-100"><Trash2 size={18} /></button>
                  </div>
                ))
              ) : (
                <div className="p-8 bg-slate-50 rounded-2xl text-center font-bold text-slate-400 text-base border-2 border-dashed border-slate-200">현재 공실입니다. 예약 등록이 가능합니다.</div>
              )}
            </div>

            <div className="pt-8 border-t-2 border-slate-100">
              <h4 className="text-sm font-bold text-blue-600 mb-6 flex items-center gap-2"><PlusCircle size={18}/> 이 날짜에 예약 추가하기</h4>
              {renderReservationForm(true)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}