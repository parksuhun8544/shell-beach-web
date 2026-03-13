import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, onSnapshot, 
  serverTimestamp, deleteDoc, doc, getDocs, writeBatch
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, onAuthStateChanged 
} from 'firebase/auth';
import { 
  Calendar, PlusCircle, BarChart3, ChevronLeft, 
  ChevronRight, BedDouble, X, TrendingUp, Users, Wallet, Trash2, Search, Check, TableProperties, Lock, RefreshCw, AlertTriangle, Phone, ExternalLink
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

// 제공된 CSV 기반 2026년 통합 데이터
const INITIAL_DATA = [
  { date: '2026-01-01', room: 'Shell', name: '염준돈', path: '여기어때', nights: 1, price: 120000, adults: 0, kids: 0 },
  { date: '2026-01-01', room: 'Pine', name: '손미향', path: '떠나요', nights: 1, price: 220000, adults: 0, kids: 0 },
  { date: '2026-01-02', room: 'Pine', name: '박정아', phone: '01068882804', path: '네이버펜션', nights: 2, price: 440000, adults: 1, kids: 0 },
  { date: '2026-01-03', room: 'Shell', name: '이태훈', path: '떠나요', nights: 1, price: 120000, adults: 0, kids: 0 },
  { date: '2026-01-03', room: 'Beach', name: '임정아', phone: '01036780953', path: '네이버플레이스', nights: 1, price: 220000, adults: 0, kids: 0 },
  { date: '2026-02-06', room: 'Pine', name: '박세진', phone: '01027593827', path: '네이버플레이스', nights: 1, price: 220000, adults: 0, kids: 0 },
  { date: '2026-02-14', room: 'Shell', name: '김주호', phone: '01032130905', path: '네이버펜션', nights: 2, price: 255000, adults: 1, kids: 0 },
  { date: '2026-03-01', room: 'Shell', name: '박미선', phone: '01052631263', path: '네이버펜션', nights: 1, price: 120000, adults: 0, kids: 0 },
  { date: '2026-04-04', room: 'Beach', name: '강홍석', phone: '01026554359', path: '네이버플레이스', nights: 1, price: 260000, adults: 1, kids: 0 },
  { date: '2026-04-04', room: 'Pine', name: '박준하', phone: '01049165910', path: '네이버플레이스', nights: 1, price: 415000, adults: 0, kids: 1 },
  { date: '2026-05-15', room: 'Beach', name: '박인희', phone: '01048307024', path: '네이버지도', nights: 2, price: 400000, adults: 0, kids: 0 },
  { date: '2026-07-14', room: 'Pine', name: '천정봉', path: '여기어때', nights: 1, price: 300000, adults: 0, kids: 0 }
];

// --- 2. 파이어베이스 설정 (이미 입력해주신 정보를 유지합니다) ---
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

// --- 3. 유틸리티 함수 ---
const formatPhone = (phone) => {
  if (!phone) return '';
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
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
  const [viewDate, setViewDate] = useState(new Date(2026, 0, 1)); 
  const [message, setMessage] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [formData, setFormData] = useState({
    date: getLocalTodayStr(), room: 'Shell', name: '', phone: '010', 
    adults: 0, kids: 0, bbq: false, nights: 1, memo: '', path: '직접'
  });

  const showMsg = (text, type) => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  // 1. PIN 잠금
  useEffect(() => {
    if (sessionStorage.getItem('shellBeachUnlocked') === 'true') setIsUnlocked(true);
  }, []);

  const handleLogin = (e) => {
    e.preventDefault();
    if (pinInput === '9631') {
      sessionStorage.setItem('shellBeachUnlocked', 'true');
      setIsUnlocked(true);
    } else {
      setPinError(true);
      setPinInput('');
    }
  };

  // 2. 파이어베이스 인증 및 초기화
  useEffect(() => {
    if (!isUnlocked) return;
    const initApp = async () => {
      try {
        const currentUser = (await signInAnonymously(auth)).user;
        setUser(currentUser);
        const colRef = collection(db, 'reservations');
        const snap = await getDocs(colRef);
        if (snap.empty) {
          const batch = writeBatch(db);
          INITIAL_DATA.forEach(data => {
            const newDocRef = doc(colRef);
            batch.set(newDocRef, { ...data, createdAt: serverTimestamp() });
          });
          await batch.commit();
        }
      } catch (error) { console.error(error); }
    };
    initApp();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, [isUnlocked]);

  // 3. 실시간 동기화
  useEffect(() => {
    if (!isUnlocked || !user) return;
    const unsubscribe = onSnapshot(collection(db, 'reservations'), (snap) => {
      setReservations(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (err) => {
      console.error(err);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user, isUnlocked]);

  // 4. 데이터 가공 로직
  const reservationMap = useMemo(() => {
    const map = {};
    reservations.forEach(res => {
      if (!res.date) return;
      const [y, m, d] = res.date.split('-');
      const start = new Date(Number(y), Number(m)-1, Number(d));
      for (let i=0; i<(res.nights||1); i++) {
        const target = new Date(start);
        target.setDate(start.getDate() + i);
        const dateStr = `${target.getFullYear()}-${String(target.getMonth()+1).padStart(2,'0')}-${String(target.getDate()).padStart(2,'0')}`;
        if (!map[dateStr]) map[dateStr] = [];
        map[dateStr].push(res);
      }
    });
    return map;
  }, [reservations]);

  // 해당 기간 동안 객실이 이미 차있는지 체크
  const isRoomFull = (roomType, startDate, nights) => {
    const [y, m, d] = startDate.split('-');
    const start = new Date(Number(y), Number(m)-1, Number(d));
    for (let i = 0; i < nights; i++) {
      const current = new Date(start);
      current.setDate(start.getDate() + i);
      const dateStr = `${current.getFullYear()}-${String(current.getMonth()+1).padStart(2,'0')}-${String(current.getDate()).padStart(2,'0')}`;
      if (reservationMap[dateStr]?.some(r => r.room === roomType)) return true;
    }
    return false;
  };

  const stats = useMemo(() => {
    let revenue = 0;
    const monthlyRoomStats = Array(12).fill(null).map(() => ({ Shell: 0, Beach: 0, Pine: 0, total: 0 }));
    reservations.forEach(r => {
      const price = Number(r.price) || 0;
      revenue += price;
      if (r.date) {
        const [y, m] = r.date.split('-');
        if (y === '2026') {
          const mIdx = Number(m) - 1;
          if (mIdx >= 0 && mIdx < 12 && r.room) {
            monthlyRoomStats[mIdx][r.room] += price;
            monthlyRoomStats[mIdx].total += price;
          }
        }
      }
    });
    return { revenue, count: reservations.length, monthlyRoomStats };
  }, [reservations]);

  const totalPrice = useMemo(() => {
    if (!formData.date || !formData.room) return 0;
    const [y, m, d] = formData.date.split('-');
    const start = new Date(Number(y), Number(m)-1, Number(d));
    const isHigh = start.getMonth() >= 6 && start.getMonth() <= 7;
    let total = 0;
    for(let i=0; i<formData.nights; i++) {
        const curr = new Date(start);
        curr.setDate(start.getDate() + i);
        const rates = isHigh ? PRICING.high[formData.room] : PRICING.low[formData.room];
        if (!rates) continue;
        total += rates[curr.getDay() === 5 || curr.getDay() === 6 ? 1 : 0];
    }
    const guestCharges = (formData.adults * 20000) + (formData.kids * 15000);
    const bbqCharge = formData.bbq ? 30000 : 0;
    return total + (guestCharges * formData.nights) + bbqCharge;
  }, [formData]);

  const filteredReservations = useMemo(() => {
    if (!searchTerm) return reservations;
    const s = searchTerm.toLowerCase();
    return reservations.filter(r => (r.name?.includes(s)) || (r.phone?.includes(s)));
  }, [reservations, searchTerm]);

  // 5. 핸들러
  const handleSave = async (e) => {
    e.preventDefault();
    if (isRoomFull(formData.room, formData.date, formData.nights)) {
      showMsg("해당 기간에 이미 예약된 객실입니다.", "error");
      return;
    }
    try {
      await addDoc(collection(db, 'reservations'), { ...formData, price: totalPrice, createdAt: serverTimestamp() });
      showMsg("예약이 저장되었습니다.", "success");
      setIsModalOpen(false);
      if (activeTab === 'add') setActiveTab('calendar');
    } catch (e) { showMsg("실패", "error"); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("삭제하시겠습니까?")) return;
    await deleteDoc(doc(db, 'reservations', id));
    showMsg("삭제 완료", "success");
  };

  const resetData = async () => {
    if (!window.confirm("주의: 모든 데이터를 지우고 정식 초기 데이터로 초기화하시겠습니까?")) return;
    setLoading(true);
    const colRef = collection(db, 'reservations');
    const snap = await getDocs(colRef);
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    INITIAL_DATA.forEach(data => batch.set(doc(colRef), { ...data, createdAt: serverTimestamp() }));
    await batch.commit();
    showMsg("데이터 초기화 완료", "success");
    setLoading(false);
  };

  const handlePhoneChange = (e) => {
    let val = e.target.value.replace(/[^0-9]/g, '');
    if (!val.startsWith('010')) val = '010' + val;
    setFormData({ ...formData, phone: val });
  };

  // --- 6. 렌더링 양식 ---
  const renderReservationForm = (isModal = false) => (
    <form onSubmit={handleSave} className="space-y-4">
      {/* 객실 선택 (마감 처리 포함) */}
      <div className="grid grid-cols-3 gap-2">
        {ROOMS.map(r => {
          const full = isRoomFull(r.id, formData.date, formData.nights);
          return (
            <button key={r.id} type="button" disabled={full} onClick={() => setFormData({...formData, room: r.id})} 
              className={`p-3 rounded-xl font-black border-2 transition-all flex flex-col items-center justify-center
              ${full ? 'bg-slate-50 border-slate-100 text-slate-300 opacity-50' : 
                formData.room === r.id ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white border-slate-100 text-slate-500 hover:border-blue-200'}`}>
              <span className="text-xs md:text-sm">{r.name}</span>
              {full && <span className="text-[10px] text-rose-400 font-bold mt-1">예약 마감</span>}
            </button>
          );
        })}
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {!isModal && (
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1">체크인 날짜</label>
            <input type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="p-3 bg-slate-50 rounded-xl font-bold border-none outline-none focus:ring-2 ring-blue-500 text-sm" required />
          </div>
        )}
        <div className="flex flex-col">
          <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1">숙박 일수</label>
          <select value={formData.nights} onChange={e => setFormData({...formData, nights: Number(e.target.value)})} className="p-3 bg-slate-50 rounded-xl font-bold border-none outline-none focus:ring-2 ring-blue-500 text-sm">
            {[1,2,3,4,5,6,7].map(n => <option key={n} value={n}>{n}박</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1">성함</label>
          <input type="text" placeholder="예약자명" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="p-3 bg-slate-50 rounded-xl font-bold border-none outline-none focus:ring-2 ring-blue-500 text-sm" required />
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1">연락처</label>
          <input type="tel" placeholder="010-0000-0000" value={formatPhone(formData.phone)} onChange={handlePhoneChange} className="p-3 bg-slate-50 rounded-xl font-bold border-none outline-none focus:ring-2 ring-blue-500 text-sm" />
        </div>
      </div>

      {/* 인원 설정 */}
      <div className="bg-slate-50 p-4 rounded-2xl space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-slate-500 mb-1 ml-1">성인(8세~, 2만)</label>
            <input type="number" min="0" value={formData.adults} onChange={e => setFormData({...formData, adults: Number(e.target.value)})} className="p-2.5 rounded-xl border-none font-bold text-center text-sm" />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-slate-500 mb-1 ml-1">아동(~7세, 1.5만)</label>
            <input type="number" min="0" value={formData.kids} onChange={e => setFormData({...formData, kids: Number(e.target.value)})} className="p-2.5 rounded-xl border-none font-bold text-center text-sm" />
          </div>
        </div>
        <button type="button" onClick={() => setFormData({...formData, bbq: !formData.bbq})} className={`w-full p-2.5 rounded-xl font-bold border-2 text-xs transition-all ${formData.bbq ? 'bg-rose-500 text-white border-rose-500' : 'bg-white text-slate-400 border-slate-100'}`}>
           바베큐 그릴 (30,000원) {formData.bbq ? '신청완료' : '미신청'}
        </button>
      </div>

      <div className="p-4 bg-slate-900 rounded-2xl text-white flex justify-between items-center shadow-lg">
        <div>
          <p className="text-[10px] font-bold text-blue-300">합계 금액</p>
          <p className="text-xl md:text-2xl font-black">₩{totalPrice.toLocaleString()}</p>
        </div>
        <button type="submit" className="px-6 py-3 bg-blue-600 rounded-xl font-black text-sm hover:bg-blue-500 transition-all">예약 저장</button>
      </div>
    </form>
  );

  if (!isUnlocked) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white p-10 rounded-[2.5rem] shadow-2xl text-center">
        <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center text-blue-600 mx-auto mb-6"><Lock size={32}/></div>
        <h1 className="text-xl font-black text-slate-800 mb-6 tracking-tighter uppercase">Shell Beach Admin</h1>
        <form onSubmit={handleLogin} className="space-y-4">
          <input type="password" maxLength={4} value={pinInput} onChange={e => setPinInput(e.target.value)} className="w-full p-4 text-center text-3xl font-black bg-slate-50 border-2 rounded-2xl outline-none" placeholder="PIN" autoFocus />
          <button type="submit" className="w-full p-4 bg-blue-600 text-white font-black rounded-2xl shadow-lg">시스템 접속</button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col md:flex-row h-screen bg-slate-50 overflow-hidden font-sans selection:bg-blue-100">
      {message && <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[1000] px-6 py-2.5 rounded-full shadow-2xl font-bold animate-in slide-in-from-top-4 ${message.type === 'success' ? 'bg-slate-900 text-white' : 'bg-rose-600 text-white'}`}>{message.text}</div>}

      <nav className="w-full md:w-60 border-r border-slate-200 flex md:flex-col p-4 md:p-5 space-y-2 bg-white shadow-xl z-20 shrink-0">
        <div className="hidden md:block p-6 bg-blue-600 text-white rounded-[1.5rem] mb-4 shadow-xl">
          <BedDouble size={24} className="mb-3" />
          <h1 className="font-black text-lg uppercase tracking-tighter leading-none">Shell<br/>Beach</h1>
          <div className="mt-3 text-[10px] bg-white/20 p-2 rounded-lg font-bold flex items-center gap-1.5"><Check size={10}/> 실시간 동기화 중</div>
        </div>
        
        {[
          { id: 'calendar', icon: Calendar, label: '현황판' },
          { id: 'add', icon: PlusCircle, label: '예약 등록' },
          { id: 'search', icon: Search, label: '예약 검색' },
          { id: 'stats', icon: BarChart3, label: '경영 통계' }
        ].map(item => (
          <button key={item.id} onClick={() => setActiveTab(item.id)} className={`flex items-center gap-3 p-3.5 rounded-xl font-bold transition-all ${activeTab === item.id ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-100'}`}>
            <item.icon size={18}/>
            <span className="text-sm">{item.label}</span>
          </button>
        ))}
        
        <button onClick={resetData} className="mt-auto flex items-center gap-3 p-3.5 rounded-xl font-bold text-rose-500 hover:bg-rose-50 transition-all">
          <RefreshCw size={18}/> <span className="text-sm">데이터 초기화</span>
        </button>
      </nav>

      <main className="flex-1 overflow-auto relative bg-slate-50">
        {loading && <div className="absolute inset-0 z-50 bg-white/60 backdrop-blur-sm flex items-center justify-center font-black text-slate-400 text-sm tracking-widest uppercase">Syncing...</div>}
        
        <div className="p-4 md:p-6 max-w-[1300px] mx-auto">
          {activeTab === 'calendar' && (
            <div className="space-y-4 animate-in fade-in">
              <header className="flex flex-col md:flex-row justify-between items-center bg-white p-5 rounded-[1.5rem] shadow-sm border border-slate-200">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-50 p-2.5 rounded-xl text-blue-600"><Calendar size={20}/></div>
                  <h2 className="text-xl font-black text-slate-800">{viewDate.getFullYear()}년 {viewDate.getMonth() + 1}월</h2>
                </div>
                <div className="flex gap-1.5 bg-slate-100 p-1.5 rounded-xl mt-3 md:mt-0">
                  <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))} className="p-1.5 hover:bg-white rounded-lg shadow-sm"><ChevronLeft size={18}/></button>
                  <button onClick={() => setViewDate(new Date())} className="px-4 font-bold text-[11px] text-blue-600">오늘</button>
                  <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))} className="p-1.5 hover:bg-white rounded-lg shadow-sm"><ChevronRight size={18}/></button>
                </div>
              </header>

              <div className="grid grid-cols-7 bg-white rounded-[1.5rem] shadow-lg overflow-hidden border border-slate-200/60">
                {['일','월','화','수','목','금','토'].map((d, i) => (
                  <div key={d} className={`p-3 text-center text-[10px] font-black border-b border-slate-100 ${i === 0 ? 'text-rose-500 bg-rose-50/20' : i === 6 ? 'text-blue-500 bg-blue-50/20' : 'text-slate-400 bg-slate-50'}`}>{d}</div>
                ))}
                {Array.from({ length: 42 }).map((_, i) => {
                  const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
                  const day = i - firstDay + 1;
                  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
                  const dateStr = day > 0 && day <= daysInMonth ? `${viewDate.getFullYear()}-${String(viewDate.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}` : null;
                  const dayRes = dateStr ? (reservationMap[dateStr] || []) : [];
                  
                  return (
                    <div key={i} onClick={() => dateStr && (setFormData({...formData, date: dateStr}), setIsModalOpen(true))} 
                      className={`min-h-[100px] md:min-h-[120px] p-2 border-r border-b border-slate-100 cursor-pointer hover:bg-blue-50/20 transition-all ${!dateStr ? 'bg-slate-50/30' : 'bg-white'}`}>
                      {dateStr && (
                        <>
                          <span className={`text-sm font-black ${new Date(dateStr).getDay() === 0 ? 'text-rose-500' : new Date(dateStr).getDay() === 6 ? 'text-blue-500' : 'text-slate-600'}`}>{day}</span>
                          <div className="mt-1.5 space-y-0.5">
                            {dayRes.map((r, idx) => (
                              <div key={idx} className={`text-[9px] p-1 rounded-md border font-bold truncate flex items-center gap-1 ${ROOMS.find(rm => rm.id === r.room)?.color || 'bg-slate-100'}`}>
                                <div className={`w-1 h-1 rounded-full ${ROOMS.find(rm => rm.id === r.room)?.dot || 'bg-slate-300'}`}></div>
                                {r.name}
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

          {activeTab === 'add' && (
            <div className="max-w-3xl mx-auto space-y-6 animate-in slide-in-from-bottom-6">
               <div className="bg-white p-8 md:p-10 rounded-[2rem] shadow-xl border border-slate-200">
                  <h2 className="text-2xl font-black text-slate-800 mb-8 border-b pb-5 flex items-center gap-3"><PlusCircle className="text-blue-600"/> 신규 예약 등록</h2>
                  {renderReservationForm(false)}
               </div>
            </div>
          )}

          {activeTab === 'search' && (
            <div className="max-w-3xl mx-auto space-y-5 animate-in slide-in-from-bottom-6">
              <h2 className="text-2xl font-black text-slate-800">예약 내역 검색</h2>
              <div className="relative group">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <input type="text" placeholder="성함 또는 연락처 입력..." className="w-full p-5 pl-14 bg-white border border-slate-200 rounded-2xl shadow-sm text-lg font-bold outline-none focus:ring-4 ring-blue-500/10 focus:border-blue-500" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
              </div>
              
              <div className="space-y-3">
                {filteredReservations.length > 0 ? (
                  filteredReservations.map(r => (
                    <div key={r.id} className="bg-white p-6 rounded-[1.5rem] border border-slate-100 flex flex-col md:flex-row justify-between md:items-center gap-4 shadow-sm hover:shadow-md transition-all border-l-4 border-l-blue-500">
                      <div className="flex items-center gap-5">
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-xl ${ROOMS.find(rm => rm.id === r.room)?.color || 'bg-slate-100'}`}>
                          {r.room ? r.room[0] : '?'}
                        </div>
                        <div>
                          <p className="text-xl font-black text-slate-800">{r.name}님 <span className="text-[11px] font-bold text-blue-500 ml-2 px-2 py-0.5 bg-blue-50 rounded-md uppercase">{r.room}</span></p>
                          <p className="text-slate-500 font-bold mt-0.5 text-xs">{r.date} 입실 • {r.nights}박</p>
                          {r.phone && (
                            <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1.5 mt-2 text-blue-600 font-bold hover:underline bg-blue-50 px-3 py-1 rounded-full text-[11px]">
                              <Phone size={11}/> {formatPhone(r.phone)} <ExternalLink size={10}/>
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between items-center md:flex-col md:items-end gap-1 border-t md:border-t-0 pt-3 md:pt-0">
                        <p className="text-xl font-black text-slate-900">₩{(Number(r.price)||0).toLocaleString()}</p>
                        <button onClick={() => handleDelete(r.id)} className="text-rose-500 font-black text-[10px] px-3 py-1.5 bg-rose-50 rounded-lg hover:bg-rose-500 hover:text-white transition-all">삭제</button>
                      </div>
                    </div>
                  ))
                ) : <div className="p-20 text-center text-slate-400 font-bold text-sm bg-white rounded-2xl border-2 border-dashed">검색 결과가 없습니다.</div>}
              </div>
            </div>
          )}

          {activeTab === 'stats' && (
            <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-center">
                <div className="bg-slate-900 p-8 rounded-[1.5rem] text-white shadow-xl relative overflow-hidden group">
                  <div className="absolute -right-4 -top-4 opacity-10 group-hover:scale-110 transition-transform"><Wallet size={100}/></div>
                  <p className="text-blue-300 font-bold text-xs">2026 누적 총 매출</p>
                  <p className="text-3xl font-black mt-2">₩{stats.revenue.toLocaleString()}</p>
                </div>
                <div className="bg-white p-8 rounded-[1.5rem] border border-slate-200 shadow-sm relative overflow-hidden group">
                  <div className="absolute -right-4 -top-4 opacity-5 group-hover:scale-110 transition-transform"><Users size={100}/></div>
                  <p className="text-slate-500 font-bold text-xs">총 예약 건수</p>
                  <p className="text-3xl font-black mt-2 text-slate-800">{stats.count}건</p>
                </div>
              </div>
              
              <div className="bg-white p-8 rounded-[2rem] border border-slate-200 overflow-x-auto shadow-sm">
                <h4 className="font-black text-lg mb-6 flex items-center gap-2"><TableProperties className="text-blue-600" size={18}/> 월별 상세 매출</h4>
                <table className="w-full text-left min-w-[600px]">
                  <thead>
                    <tr className="border-b-2 border-slate-100 text-slate-400 text-[11px] font-black uppercase">
                      <th className="py-4 pl-4">구분 (월)</th>
                      <th className="py-4">Shell</th>
                      <th className="py-4">Beach</th>
                      <th className="py-4">Pine</th>
                      <th className="py-4 pr-4 text-slate-900 text-right">월간 합계</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs">
                    {stats.monthlyRoomStats.map((s, i) => (
                      <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${s.total === 0 ? 'opacity-20' : ''}`}>
                        <td className="py-4 pl-4 font-bold text-slate-700">{i+1}월</td>
                        <td>₩{s.Shell.toLocaleString()}</td>
                        <td>₩{s.Beach.toLocaleString()}</td>
                        <td>₩{s.Pine.toLocaleString()}</td>
                        <td className="pr-4 font-black text-blue-600 text-right">₩{s.total.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 모달 팝업 */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in" onClick={() => setIsModalOpen(false)}>
          <div className="bg-white w-full max-w-xl rounded-[2rem] p-8 relative overflow-y-auto max-h-[92vh] shadow-2xl animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
            <button onClick={() => setIsModalOpen(false)} className="absolute top-6 right-6 p-2 bg-slate-100 text-slate-500 rounded-full hover:bg-rose-500 hover:text-white transition-all"><X size={18}/></button>
            
            <div className="mb-6">
              <h3 className="text-2xl font-black text-slate-900">{formData.date}</h3>
              <p className="text-blue-600 font-bold text-[10px] tracking-widest mt-0.5 uppercase">Daily Reservation View</p>
            </div>

            <div className="mb-8 space-y-2.5">
              {(reservationMap[formData.date] || []).length > 0 ? (
                reservationMap[formData.date].map((r, i) => (
                  <div key={`${r.id}-${i}`} className={`p-4 rounded-2xl border flex justify-between items-center shadow-sm ${ROOMS.find(rm => rm.id === r.room)?.color || 'bg-slate-50'}`}>
                    <div>
                      <span className="font-black text-lg">{r.room}</span>
                      <span className="ml-3 font-bold text-sm text-slate-600">{r.name}님</span>
                      <div className="text-[10px] font-bold mt-1 opacity-60 flex items-center gap-3">
                        {r.phone && (
                          <a href={`tel:${r.phone}`} className="text-blue-600 underline flex items-center gap-1">
                             {formatPhone(r.phone)}
                          </a>
                        )}
                        <span>{r.adults} / {r.kids} / {r.nights}박</span>
                      </div>
                    </div>
                    <button onClick={() => handleDelete(r.id)} className="text-rose-500 p-2.5 bg-white/60 rounded-xl hover:bg-rose-500 hover:text-white transition-all"><Trash2 size={18}/></button>
                  </div>
                ))
              ) : <div className="p-8 bg-slate-50 rounded-2xl text-center font-bold text-slate-400 border-2 border-dashed text-xs">등록된 예약 내역이 없습니다.</div>}
            </div>

            <div className="pt-8 border-t-2 border-slate-100">
              <h4 className="font-black text-md mb-6 text-blue-600 flex items-center gap-2"><PlusCircle size={18}/> 새 예약 등록</h4>
              {renderReservationForm(true)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
