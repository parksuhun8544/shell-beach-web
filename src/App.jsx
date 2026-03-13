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
  ChevronRight, BedDouble, X, TrendingUp, Users, Wallet, Trash2, Search, Check, TableProperties, Lock, RefreshCw, AlertTriangle, Phone
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

// CSV 기반 2026년 초기 데이터 세트
const INITIAL_DATA = [
  { date: '2026-01-01', room: 'Shell', name: '염준돈', path: '여기어때', nights: 1, price: 120000, adults: 0, kids: 0 },
  { date: '2026-01-01', room: 'Pine', name: '손미향', path: '떠나요', nights: 1, price: 220000, adults: 0, kids: 0 },
  { date: '2026-01-02', room: 'Pine', name: '박정아', phone: '01068882804', path: '네이버펜션', nights: 2, price: 440000, adults: 1, kids: 0 },
  { date: '2026-01-03', room: 'Shell', name: '이태훈', path: '떠나요', nights: 1, price: 120000, adults: 0, kids: 0 },
  { date: '2026-01-03', room: 'Beach', name: '임정아', phone: '01036780953', path: '네이버플레이스', nights: 1, price: 220000, adults: 0, kids: 0 },
  { date: '2026-02-14', room: 'Shell', name: '김주호', phone: '01032130905', path: '네이버펜션', nights: 2, price: 255000, adults: 1, kids: 0 },
  { date: '2026-03-01', room: 'Shell', name: '박미선', phone: '01052631263', path: '네이버펜션', nights: 1, price: 120000, adults: 0, kids: 0 },
  { date: '2026-04-04', room: 'Beach', name: '강홍석', phone: '01026554359', path: '네이버플레이스', nights: 1, price: 260000, adults: 1, kids: 0 },
  { date: '2026-04-04', room: 'Pine', name: '박준하', phone: '01049165910', path: '네이버플레이스', nights: 1, price: 415000, adults: 0, kids: 1 },
  { date: '2026-05-15', room: 'Beach', name: '박인희', phone: '01048307024', path: '네이버지도', nights: 2, price: 400000, adults: 0, kids: 0 }
];

// --- 2. 파이어베이스 초기화 (제공해주신 정보를 적용했습니다) ---
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

// 유틸리티 함수
const formatPhone = (phone) => {
  if (!phone) return '';
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.startsWith('010') && digits.length === 11) {
    return `${digits.slice(0,3)}-${digits.slice(3,7)}-${digits.slice(7)}`;
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
  const [viewDate, setViewDate] = useState(new Date(2026, 0, 1)); 
  const [message, setMessage] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [formData, setFormData] = useState({
    date: getLocalTodayStr(), room: 'Shell', name: '', phone: '', 
    adults: 0, kids: 0, bbq: false, nights: 1, memo: '', path: '직접'
  });

  const isConfigured = !firebaseConfig.apiKey.includes("본인");

  const showMsg = (text, type) => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  // 1. PIN 잠금 처리
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

  // 2. 파이어베이스 인증 및 초기 데이터 주입
  useEffect(() => {
    if (!isUnlocked || !isConfigured) {
      if (!isConfigured) setLoading(false);
      return;
    }

    const initApp = async () => {
      try {
        const currentUser = (await signInAnonymously(auth)).user;
        setUser(currentUser);
        
        const colRef = collection(db, 'reservations');
        const snap = await getDocs(colRef);
        
        // 데이터가 비어있을 경우에만 초기 데이터 주입
        if (snap.empty) {
          const batch = writeBatch(db);
          INITIAL_DATA.forEach(data => {
            const newDocRef = doc(colRef);
            batch.set(newDocRef, { ...data, createdAt: serverTimestamp() });
          });
          await batch.commit();
          showMsg("시스템 준비 완료", "success");
        }
      } catch (error) { 
        console.error("Auth Error:", error);
      }
    };
    initApp();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, [isUnlocked, isConfigured]);

  // 3. 실시간 동기화
  useEffect(() => {
    if (!isUnlocked || !user || !isConfigured) return;
    const unsubscribe = onSnapshot(collection(db, 'reservations'), (snap) => {
      setReservations(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (err) => {
      console.error(err);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user, isUnlocked, isConfigured]);

  // 4. 데이터 가공
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
    // 추가 요금 (인당 금액 * 박수)
    const guestCharges = (formData.adults * 20000) + (formData.kids * 15000);
    const bbqCharge = formData.bbq ? 30000 : 0;
    return total + (guestCharges * formData.nights) + bbqCharge;
  }, [formData]);

  const filteredReservations = useMemo(() => {
    if (!searchTerm) return reservations;
    const s = searchTerm.toLowerCase();
    return reservations.filter(r => (r.name?.includes(s)) || (r.phone?.includes(s)));
  }, [reservations, searchTerm]);

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'reservations'), { ...formData, price: totalPrice, createdAt: serverTimestamp() });
      showMsg("예약이 저장되었습니다.", "success");
      setIsModalOpen(false);
      if (activeTab === 'add') setActiveTab('calendar');
    } catch (e) { showMsg("저장 실패", "error"); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("정말 삭제하시겠습니까?")) return;
    await deleteDoc(doc(db, 'reservations', id));
    showMsg("삭제 완료", "success");
  };

  const resetData = async () => {
    if (!window.confirm("주의: 모든 데이터를 지우고 정식 기초 데이터로 초기화하시겠습니까?")) return;
    setLoading(true);
    try {
      const colRef = collection(db, 'reservations');
      const snap = await getDocs(colRef);
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.delete(d.ref));
      INITIAL_DATA.forEach(data => batch.set(doc(colRef), { ...data, createdAt: serverTimestamp() }));
      await batch.commit();
      showMsg("데이터가 초기화되었습니다.", "success");
    } catch (e) {
      showMsg("초기화 실패", "error");
    }
    setLoading(false);
  };

  // 공통 입력 폼 렌더링
  const renderReservationForm = (isModal = false) => (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="grid grid-cols-3 gap-2">
        {ROOMS.map(r => (
          <button key={r.id} type="button" onClick={() => setFormData({...formData, room: r.id})} 
            className={`p-4 rounded-2xl font-black border-2 transition-all ${formData.room === r.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200 text-slate-500'}`}>
            {r.name}
          </button>
        ))}
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {!isModal && (
          <div className="flex flex-col">
            <label className="text-xs font-bold text-slate-400 ml-2 mb-1">체크인 날짜</label>
            <input type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="p-4 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-100" required />
          </div>
        )}
        <div className="flex flex-col">
          <label className="text-xs font-bold text-slate-400 ml-2 mb-1">숙박 기간</label>
          <select value={formData.nights} onChange={e => setFormData({...formData, nights: Number(e.target.value)})} className="p-4 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-100">
            {[1,2,3,4,5,6,7].map(n => <option key={n} value={n}>{n}박</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-bold text-slate-400 ml-2 mb-1">예약자 성함</label>
          <input type="text" placeholder="성함 입력" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="p-4 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-100" required />
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-bold text-slate-400 ml-2 mb-1">연락처</label>
          <input type="tel" placeholder="01012345678" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="p-4 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-100" />
        </div>
      </div>

      <div className="bg-blue-50/50 p-6 rounded-3xl space-y-4 border border-blue-100">
        <h4 className="text-sm font-black text-blue-800 flex items-center gap-2"><PlusCircle size={16}/> 인원 및 옵션 추가</h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-slate-500 mb-1">성인(8세~, 2.0만)</label>
            <input type="number" min="0" value={formData.adults} onChange={e => setFormData({...formData, adults: Number(e.target.value)})} className="p-3 rounded-xl border-none font-bold" />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-slate-500 mb-1">아동(~7세, 1.5만)</label>
            <input type="number" min="0" value={formData.kids} onChange={e => setFormData({...formData, kids: Number(e.target.value)})} className="p-3 rounded-xl border-none font-bold" />
          </div>
        </div>
        <button type="button" onClick={() => setFormData({...formData, bbq: !formData.bbq})} className={`w-full p-3 rounded-xl font-bold border-2 transition-all flex items-center justify-center gap-2 ${formData.bbq ? 'bg-rose-500 text-white border-rose-500' : 'bg-white text-slate-400 border-slate-100'}`}>
          <Check size={16}/> 바베큐 그릴 (30,000원) {formData.bbq ? '선택됨' : '미선택'}
        </button>
      </div>

      <div className="p-6 bg-slate-900 rounded-3xl text-white flex flex-col md:flex-row justify-between items-center gap-4 shadow-xl">
        <div className="text-center md:text-left">
          <p className="text-xs font-bold text-blue-300">합계 결제 금액</p>
          <p className="text-4xl font-black">₩{totalPrice.toLocaleString()}</p>
        </div>
        <button type="submit" className="w-full md:w-auto px-10 py-4 bg-blue-600 rounded-2xl font-black text-lg hover:bg-blue-500 transition-all">예약 확정하기</button>
      </div>
    </form>
  );

  if (!isUnlocked) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white p-10 rounded-[2.5rem] shadow-2xl text-center">
        <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center text-blue-600 mx-auto mb-6"><Lock size={36}/></div>
        <h1 className="text-2xl font-black mb-2 text-slate-800">관리자 로그인</h1>
        <p className="text-sm font-bold text-slate-400 mb-8">액세스 PIN 번호를 입력하세요</p>
        <form onSubmit={handleLogin} className="space-y-4">
          <input type="password" maxLength={4} value={pinInput} onChange={e => setPinInput(e.target.value)} className={`w-full p-4 text-center text-3xl font-black bg-slate-50 border-2 rounded-2xl outline-none transition-all ${pinError ? 'border-rose-500' : 'border-slate-100 focus:border-blue-500'}`} placeholder="••••" autoFocus />
          <button type="submit" className="w-full p-4 bg-blue-600 text-white font-black rounded-2xl shadow-lg">시스템 접속</button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col md:flex-row h-screen bg-slate-50 overflow-hidden font-sans">
      {message && <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[1000] px-8 py-3 rounded-full shadow-2xl font-bold animate-in slide-in-from-top-4 ${message.type === 'success' ? 'bg-slate-900 text-white' : 'bg-rose-600 text-white'}`}>{message.text}</div>}

      <nav className="w-full md:w-72 border-r border-slate-200 flex md:flex-col p-6 space-y-3 bg-white shadow-xl z-20 shrink-0">
        <div className="hidden md:block p-8 bg-blue-600 text-white rounded-[2rem] mb-6 shadow-xl">
          <BedDouble size={32} className="mb-4" />
          <h1 className="font-black text-2xl uppercase tracking-tighter leading-none">Shell<br/>Beach</h1>
          {!isConfigured && <div className="mt-4 text-[10px] bg-rose-500 p-2 rounded-lg font-bold flex items-center gap-2"><AlertTriangle size={12}/> 설정 필요</div>}
          {isConfigured && user && <div className="mt-4 text-[10px] bg-emerald-500 p-2 rounded-lg font-bold flex items-center gap-2"><Check size={12}/> DB 동기화 완료</div>}
        </div>
        
        {[
          { id: 'calendar', icon: Calendar, label: '현황판' },
          { id: 'add', icon: PlusCircle, label: '예약 등록' },
          { id: 'search', icon: Search, label: '예약 검색' },
          { id: 'stats', icon: BarChart3, label: '경영 통계' }
        ].map(item => (
          <button key={item.id} onClick={() => setActiveTab(item.id)} className={`flex items-center gap-4 p-4 rounded-2xl font-bold transition-all ${activeTab === item.id ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-100'}`}>
            <item.icon size={20}/>
            <span>{item.label}</span>
          </button>
        ))}
        
        <button onClick={resetData} className="mt-auto flex items-center gap-4 p-4 rounded-2xl font-bold text-rose-500 hover:bg-rose-50 transition-all">
          <RefreshCw size={20}/> 데이터 초기화
        </button>
      </nav>

      <main className="flex-1 overflow-auto relative">
        {loading && <div className="absolute inset-0 z-50 bg-white/60 backdrop-blur-sm flex items-center justify-center font-black text-slate-400 text-lg">데이터 연동 중...</div>}
        
        <div className="p-4 md:p-10 max-w-[1400px] mx-auto">
          {activeTab === 'calendar' && (
            <div className="space-y-6 animate-in fade-in">
              <header className="flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-200">
                <div className="flex items-center gap-4">
                  <div className="bg-blue-50 p-3 rounded-2xl text-blue-600"><Calendar size={24}/></div>
                  <h2 className="text-2xl font-black text-slate-800">{viewDate.getFullYear()}년 {viewDate.getMonth() + 1}월</h2>
                </div>
                <div className="flex gap-2 bg-slate-50 p-2 rounded-2xl mt-4 md:mt-0">
                  <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))} className="p-2 hover:bg-white rounded-xl shadow-sm"><ChevronLeft/></button>
                  <button onClick={() => setViewDate(new Date())} className="px-6 font-bold text-sm text-blue-600">오늘</button>
                  <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))} className="p-2 hover:bg-white rounded-xl shadow-sm"><ChevronRight/></button>
                </div>
              </header>

              <div className="grid grid-cols-7 bg-white rounded-[2.5rem] shadow-xl overflow-hidden border border-slate-200/60">
                {['일','월','화','수','목','금','토'].map((d, i) => (
                  <div key={d} className={`p-4 text-center text-xs font-black border-b border-slate-100 ${i === 0 ? 'text-rose-500 bg-rose-50/20' : i === 6 ? 'text-blue-500 bg-blue-50/20' : 'text-slate-400 bg-slate-50/50'}`}>{d}</div>
                ))}
                {Array.from({ length: 42 }).map((_, i) => {
                  const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
                  const day = i - firstDay + 1;
                  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
                  const dateStr = day > 0 && day <= daysInMonth ? `${viewDate.getFullYear()}-${String(viewDate.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}` : null;
                  const dayRes = dateStr ? (reservationMap[dateStr] || []) : [];
                  
                  return (
                    <div key={i} onClick={() => dateStr && (setFormData({...formData, date: dateStr}), setIsModalOpen(true))} 
                      className={`min-h-[120px] md:min-h-[140px] p-3 border-r border-b border-slate-100 cursor-pointer hover:bg-blue-50/20 transition-all ${!dateStr ? 'bg-slate-50/30' : 'bg-white'}`}>
                      {dateStr && (
                        <>
                          <span className={`text-lg font-black ${new Date(dateStr).getDay() === 0 ? 'text-rose-500' : new Date(dateStr).getDay() === 6 ? 'text-blue-500' : 'text-slate-600'}`}>{day}</span>
                          <div className="mt-2 space-y-1">
                            {dayRes.map((r, idx) => (
                              <div key={`${r.id}-${idx}`} className={`text-[10px] p-1.5 rounded-lg border font-bold truncate flex items-center gap-1 shadow-sm ${ROOMS.find(rm => rm.id === r.room)?.color || 'bg-slate-100'}`}>
                                {r.name} {r.adults + r.kids > 0 && `(+${r.adults + r.kids})`}
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
            <div className="max-w-4xl mx-auto space-y-8 animate-in slide-in-from-bottom-6">
               <div className="bg-white p-10 rounded-[3rem] shadow-xl border border-slate-200">
                  <h2 className="text-3xl font-black text-slate-800 mb-10 border-b pb-6 text-center">신규 예약 등록</h2>
                  {renderReservationForm(false)}
               </div>
            </div>
          )}

          {activeTab === 'search' && (
            <div className="max-w-4xl mx-auto space-y-6 animate-in slide-in-from-bottom-6">
              <h2 className="text-3xl font-black text-slate-800">예약 내역 검색</h2>
              <div className="relative group">
                <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600" size={24} />
                <input type="text" placeholder="성함 또는 연락처 입력..." className="w-full p-7 pl-16 bg-white border border-slate-200 rounded-[2rem] shadow-sm text-xl font-bold outline-none focus:ring-4 ring-blue-500/10 focus:border-blue-500 transition-all" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
              </div>
              
              <div className="space-y-4">
                {filteredReservations.length > 0 ? (
                  filteredReservations.map(r => (
                    <div key={r.id} className="bg-white p-8 rounded-[2.5rem] border border-slate-100 flex flex-col md:flex-row justify-between md:items-center gap-6 shadow-sm border-l-8 border-l-blue-600">
                      <div className="flex items-center gap-6">
                        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center font-black text-2xl ${ROOMS.find(rm => rm.id === r.room)?.color || 'bg-slate-100'}`}>
                          {r.room ? r.room[0] : '?'}
                        </div>
                        <div>
                          <p className="text-2xl font-black">{r.name}님 <span className="text-sm font-bold text-blue-500 ml-2 px-3 py-1 bg-blue-50 rounded-lg">{r.room}</span></p>
                          <p className="text-slate-500 font-bold mt-1 text-sm">{r.date} 입실 • {r.nights}박</p>
                          {r.phone && (
                            <a href={`tel:${r.phone}`} className="inline-flex items-center gap-2 mt-2 text-blue-600 font-bold hover:underline bg-blue-50 px-3 py-1 rounded-full">
                              <Phone size={14}/> {formatPhone(r.phone)}
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between items-center md:flex-col md:items-end gap-2 border-t md:border-t-0 pt-4 md:pt-0">
                        <p className="text-2xl font-black text-slate-900">₩{(Number(r.price)||0).toLocaleString()}</p>
                        <button onClick={() => handleDelete(r.id)} className="text-rose-500 font-black text-xs px-5 py-2.5 bg-rose-50 rounded-xl hover:bg-rose-500 hover:text-white transition-all">예약 삭제</button>
                      </div>
                    </div>
                  ))
                ) : <div className="p-24 text-center text-slate-400 font-bold text-lg bg-white rounded-[3rem] border-2 border-dashed border-slate-200">검색 결과가 없습니다.</div>}
              </div>
            </div>
          )}

          {activeTab === 'stats' && (
            <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-center">
                <div className="bg-slate-900 p-10 rounded-[2.5rem] text-white shadow-2xl overflow-hidden relative group">
                  <div className="absolute -right-5 -top-5 opacity-10 group-hover:scale-110 transition-transform"><Wallet size={120}/></div>
                  <p className="text-blue-300 font-bold text-sm">2026 누적 총 매출액</p>
                  <p className="text-5xl font-black mt-3">₩{stats.revenue.toLocaleString()}</p>
                </div>
                <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm relative overflow-hidden group">
                  <div className="absolute -right-5 -top-5 opacity-5 group-hover:scale-110 transition-transform"><Users size={120}/></div>
                  <p className="text-slate-500 font-bold text-sm">총 예약 유치 건수</p>
                  <p className="text-5xl font-black mt-3 text-slate-800">{stats.count}건</p>
                </div>
              </div>
              
              <div className="bg-white p-10 rounded-[3rem] border border-slate-200 overflow-x-auto shadow-sm">
                <h4 className="font-black text-xl mb-8 flex items-center gap-3"><TableProperties className="text-blue-600"/> 월별 상세 매출 트렌드</h4>
                <table className="w-full text-left min-w-[700px]">
                  <thead>
                    <tr className="border-b-2 border-slate-100 text-slate-400 text-sm">
                      <th className="py-5 pl-4">구분 (월)</th>
                      <th className="py-5">Shell</th>
                      <th className="py-5">Beach</th>
                      <th className="py-5">Pine</th>
                      <th className="py-5 pr-4 text-slate-900 text-right">월간 합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.monthlyRoomStats.map((s, i) => (
                      <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${s.total === 0 ? 'opacity-20' : ''}`}>
                        <td className="py-5 pl-4 font-bold text-slate-700">{i+1}월</td>
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
          <div className="bg-white w-full max-w-2xl rounded-[3rem] p-10 relative overflow-y-auto max-h-[92vh] shadow-2xl animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
            <button onClick={() => setIsModalOpen(false)} className="absolute top-8 right-8 p-3 bg-slate-100 text-slate-500 rounded-full hover:bg-rose-500 hover:text-white transition-all"><X size={20}/></button>
            
            <div className="mb-8">
              <h3 className="text-3xl font-black text-slate-900">{formData.date} 현황</h3>
              <p className="text-blue-600 font-bold mt-1 tracking-widest">SHELL BEACH ADMIN</p>
            </div>

            <div className="mb-12 space-y-3">
              {(reservationMap[formData.date] || []).length > 0 ? (
                reservationMap[formData.date].map((r, i) => (
                  <div key={`${r.id}-${i}`} className={`p-6 rounded-3xl border flex justify-between items-center shadow-sm ${ROOMS.find(rm => rm.id === r.room)?.color || 'bg-slate-50'}`}>
                    <div>
                      <span className="font-black text-2xl">{r.room}</span>
                      <span className="ml-4 font-bold text-lg">{r.name}님</span>
                      <div className="text-xs font-bold mt-2 opacity-60 flex items-center gap-4">
                        {r.phone && (
                          <a href={`tel:${r.phone}`} className="text-blue-600 underline flex items-center gap-1">
                            <Phone size={12}/> {formatPhone(r.phone)}
                          </a>
                        )}
                        <span>성인 {r.adults} / 아동 {r.kids} / {r.nights}박</span>
                      </div>
                    </div>
                    <button onClick={() => handleDelete(r.id)} className="text-rose-500 p-4 bg-white/60 rounded-2xl hover:bg-rose-500 hover:text-white transition-all shadow-inner"><Trash2 size={22}/></button>
                  </div>
                ))
              ) : <div className="p-12 bg-slate-50 rounded-3xl text-center font-bold text-slate-400 border-2 border-dashed border-slate-200">등록된 예약 내역이 없습니다.</div>}
            </div>

            <div className="pt-10 border-t-2 border-slate-100">
              <h4 className="font-black text-xl mb-8 text-blue-600 flex items-center gap-2"><PlusCircle size={22}/> 새 예약 즉시 등록</h4>
              {renderReservationForm(true)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
