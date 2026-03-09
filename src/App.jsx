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
  ChevronRight, BedDouble, X, TrendingUp, Users, Wallet, Trash2, Search, Check, TableProperties, Lock, RefreshCw
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

// CSV 데이터 기반 2026년 통합 예약 리스트
const INITIAL_DATA = [
  // 1월
  { date: '2026-01-01', room: 'Shell', name: '염준돈', path: '여기어때', nights: 1, price: 120000 },
  { date: '2026-01-01', room: 'Pine', name: '손미향', path: '떠나요', nights: 1, price: 220000 },
  { date: '2026-01-02', room: 'Pine', name: '박정아', phone: '68882804', path: '네이버펜션', nights: 2, price: 440000 },
  { date: '2026-01-03', room: 'Shell', name: '이태훈', path: '떠나요', nights: 1, price: 120000 },
  { date: '2026-01-03', room: 'Beach', name: '임정아', phone: '36780953', path: '네이버플레이스', nights: 1, price: 220000 },
  { date: '2026-01-10', room: 'Beach', name: '황진혁', phone: '38890176', path: '네이버지도', nights: 1, price: 220000 },
  { date: '2026-01-10', room: 'Pine', name: '정희나', path: '여기어때', nights: 1, price: 400000 },
  { date: '2026-01-11', room: 'Beach', name: '허소영', path: '여기어때', nights: 1, price: 180000 },
  { date: '2026-01-11', room: 'Pine', name: '김지호', phone: '86615843', path: '네이버지도', nights: 1, price: 220000 },
  { date: '2026-01-16', room: 'Beach', name: '류희철', phone: '90107758', path: '네이버지도', nights: 1, price: 180000 },
  { date: '2026-01-17', room: 'Shell', name: '신원균', phone: '56345527', path: '네이버지도', nights: 1, price: 120000 },
  { date: '2026-01-17', room: 'Pine', name: '민경복', path: '떠나요', nights: 1, price: 400000 },
  { date: '2026-01-24', room: 'Shell', name: '이지', path: '여기어때', nights: 1, price: 120000 },
  { date: '2026-01-24', room: 'Beach', name: '유승규', phone: '72517878', path: '네이버지도', nights: 1, price: 220000 },
  { date: '2026-01-24', room: 'Pine', name: '김명규', path: '여기어때', nights: 1, price: 400000 },
  { date: '2026-01-25', room: 'Pine', name: '전세환', phone: '33350106', path: '네이버지도', nights: 1, price: 220000 },
  { date: '2026-01-26', room: 'Beach', name: '이우준', path: '여기어때', nights: 1, price: 180000 },
  { date: '2026-01-28', room: 'Pine', name: '최현희', path: '여기어때', nights: 1, price: 220000 },
  { date: '2026-01-29', room: 'Beach', name: '최현희', path: '여기어때', nights: 1, price: 180000 },
  { date: '2026-01-30', room: 'Beach', name: '정현지', path: '여기어때', nights: 1, price: 180000 },
  { date: '2026-01-31', room: 'Beach', name: '김학렬', path: '떠나요', nights: 1, price: 220000 },
  { date: '2026-01-31', room: 'Pine', name: '신호연', path: '여기어때', nights: 1, price: 400000 },

  // 2월
  { date: '2026-02-06', room: 'Pine', name: '박세진', phone: '27593827', path: '네이버플레이스', nights: 1, price: 220000 },
  { date: '2026-02-07', room: 'Shell', name: '고명현', path: '떠나요', nights: 1, price: 120000 },
  { date: '2026-02-07', room: 'Beach', name: '강보미', path: '여기어때', nights: 1, price: 220000 },
  { date: '2026-02-07', room: 'Pine', name: '박진웅', path: '떠나요', nights: 1, price: 400000 },
  { date: '2026-02-08', room: 'Pine', name: '김성운', path: '여기어때', nights: 1, price: 220000 },
  { date: '2026-02-14', room: 'Shell', name: '김주호', phone: '32130905', path: '네이버펜션', nights: 2, price: 255000 },
  { date: '2026-02-14', room: 'Beach', name: '허진보', phone: '96607799', path: '네이버지도', nights: 1, price: 220000 },
  { date: '2026-02-14', room: 'Pine', name: '한행륜', path: '여기어때', nights: 1, price: 400000 },
  { date: '2026-02-15', room: 'Beach', name: 'JINHUA', phone: '91366898', path: '떠나요', nights: 1, price: 180000 },
  { date: '2026-02-15', room: 'Pine', name: '이진우', phone: '34300999', path: '네이버펜션', nights: 1, price: 220000 },
  { date: '2026-02-16', room: 'Shell', name: 'JINGUANGZH', phone: '73228732', path: '떠나요', nights: 1, price: 100000 },
  { date: '2026-02-16', room: 'Beach', name: '박기태', path: '여기어때', nights: 1, price: 180000 },
  { date: '2026-02-17', room: 'Beach', name: '최선희', path: '여기어때', nights: 2, price: 360000 },
  { date: '2026-02-21', room: 'Beach', name: 'Dongkyun J', path: '떠나요', nights: 1, price: 220000 },
  { date: '2026-02-21', room: 'Pine', name: '김선진', phone: '40212019', path: '네이버펜션', nights: 1, price: 400000 },
  { date: '2026-02-27', room: 'Shell', name: '박수헌', path: '직접', nights: 1, price: 100000 },
  { date: '2026-02-28', room: 'Shell', name: '박수헌', path: '직접', nights: 1, price: 120000 },
  { date: '2026-02-28', room: 'Beach', name: '강주원', path: '여기어때', nights: 1, price: 220000 },
  { date: '2026-02-28', room: 'Pine', name: '김진', path: '떠나요', nights: 1, price: 400000 },

  // 3월
  { date: '2026-03-01', room: 'Shell', name: '박미선', phone: '52631263', path: '네이버펜션', nights: 1, price: 120000 },
  { date: '2026-03-01', room: 'Beach', name: '장선희', path: '여기어때', nights: 1, price: 220000 },
  { date: '2026-03-07', room: 'Shell', name: '이주희', path: '떠나요', nights: 1, price: 120000 },
  { date: '2026-03-07', room: 'Beach', name: '추연희', path: '여기어때', nights: 1, price: 220000 },
  { date: '2026-03-07', room: 'Pine', name: '배윤혜', path: '떠나요', nights: 1, price: 400000 },
  { date: '2026-03-14', room: 'Shell', name: '송성진', phone: '27215927', path: '네이버펜션', nights: 1, price: 120000 },
  { date: '2026-03-14', room: 'Beach', name: '이호재', phone: '76524666', path: '직접', nights: 1, price: 220000 },
  { date: '2026-03-21', room: 'Beach', name: '안성훈', phone: '20033451', path: '떠나요', nights: 1, price: 220000 },
  { date: '2026-03-22', room: 'Pine', name: '이민호', path: '여기어때', nights: 1, price: 220000 },
  { date: '2026-03-28', room: 'Shell', name: '박광수', phone: '87676574', path: '네이버지도', nights: 1, price: 120000 },

  // 4월
  { date: '2026-04-04', room: 'Beach', name: '강홍석', phone: '26554359', path: '네이버플레이스', nights: 1, price: 260000 },
  { date: '2026-04-04', room: 'Pine', name: '박준하', phone: '49165910', path: '네이버플레이스', nights: 1, price: 415000 },
  { date: '2026-04-12', room: 'Pine', name: '엄마지인', path: '직접', nights: 1, price: 220000 },
  { date: '2026-04-17', room: 'Beach', name: 'YUN SANG J', path: '떠나요', nights: 1, price: 180000 },
  { date: '2026-04-18', room: 'Beach', name: '이현희', path: '떠나요', nights: 1, price: 220000 },
  { date: '2026-04-18', room: 'Pine', name: '김샘', path: '떠나요', nights: 1, price: 400000 },
  { date: '2026-04-24', room: 'Beach', name: '최랑희', phone: '96886809', path: '네이버플레이스', nights: 2, price: 400000 },
  { date: '2026-04-25', room: 'Pine', name: '박기태', path: '여기어때', nights: 1, price: 400000 },

  // 5월
  { date: '2026-05-15', room: 'Beach', name: '박인희', phone: '48307024', path: '네이버지도', nights: 2, price: 400000 },
  { date: '2026-05-23', room: 'Beach', name: '이현자', path: '여기어때', nights: 2, price: 400000 },

  // 7월
  { date: '2026-07-14', room: 'Pine', name: '천정봉', path: '여기어때', nights: 1, price: 300000 }
];

// --- 2. 파이어베이스 초기화 ---
const firebaseConfig = {
  apiKey: "본인의_정보를_입력하세요",
  authDomain: "본인의_정보를_입력하세요",
  projectId: "본인의_정보를_입력하세요",
  storageBucket: "본인의_정보를_입력하세요",
  messagingSenderId: "본인의_정보를_입력하세요",
  appId: "본인의_정보를_입력하세요"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const displayPhone = (phone) => {
  if (!phone) return '연락처 없음';
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length === 8) return `010-${digits.slice(0,4)}-${digits.slice(4)}`;
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
  const [viewDate, setViewDate] = useState(new Date(2026, 0, 1)); // 2026년 1월 기준 시작
  const [message, setMessage] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState({
    date: getLocalTodayStr(), room: 'Shell', name: '', phone: '', 
    adults: 0, kids: 0, bbq: false, nights: 1, memo: '', path: '직접'
  });

  // 1. 보안 해제
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

  // 2. 인증 및 초기 데이터 주입
  useEffect(() => {
    if (!isUnlocked) return;
    if (firebaseConfig.apiKey.includes("본인")) { setLoading(false); return; }

    const initApp = async () => {
      try {
        const currentUser = (await signInAnonymously(auth)).user;
        setUser(currentUser);

        const colRef = collection(db, 'reservations');
        const snap = await getDocs(colRef);
        
        // DB가 비어있을 경우에만 2026년 대량 데이터 주입 (Batch 사용)
        if (snap.empty) {
          const batch = writeBatch(db);
          INITIAL_DATA.forEach(data => {
            const newDocRef = doc(colRef);
            batch.set(newDocRef, { ...data, createdAt: serverTimestamp() });
          });
          await batch.commit();
          showMsg("2026년 예약 데이터가 성공적으로 로드되었습니다.", "success");
        }
      } catch (error) { console.error(error); }
    };
    initApp();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, [isUnlocked]);

  // 3. 실시간 동기화
  useEffect(() => {
    if (!isUnlocked || !user || firebaseConfig.apiKey.includes("본인")) return;
    const unsubscribe = onSnapshot(collection(db, 'reservations'), (snap) => {
      setReservations(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user, isUnlocked]);

  // 데이터 가공
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
          if (monthlyRoomStats[mIdx] && r.room) {
            monthlyRoomStats[mIdx][r.room] += price;
            monthlyRoomStats[mIdx].total += price;
          }
        }
      }
    });
    return { revenue, count: reservations.length, monthlyRoomStats };
  }, [reservations]);

  const totalPrice = useMemo(() => {
    if (!formData.date) return 0;
    const [y, m, d] = formData.date.split('-');
    const start = new Date(Number(y), Number(m)-1, Number(d));
    const isHigh = start.getMonth() >= 6 && start.getMonth() <= 7;
    let total = 0;
    for(let i=0; i<formData.nights; i++) {
        const curr = new Date(start);
        curr.setDate(start.getDate() + i);
        const rates = isHigh ? PRICING.high[formData.room] : PRICING.low[formData.room];
        total += rates[curr.getDay() === 5 || curr.getDay() === 6 ? 1 : 0];
    }
    return total + ((formData.adults * 20000) + (formData.kids * 15000)) * formData.nights + (formData.bbq ? 30000 : 0);
  }, [formData]);

  const showMsg = (text, type) => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'reservations'), { ...formData, price: totalPrice, createdAt: serverTimestamp() });
      showMsg("저장 완료", "success");
      setIsModalOpen(false);
    } catch (e) { showMsg("실패", "error"); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("삭제하시겠습니까?")) return;
    await deleteDoc(doc(db, 'reservations', id));
    showMsg("삭제 완료", "success");
  };

  const resetData = async () => {
    if (!window.confirm("모든 데이터를 지우고 2026년 기본 데이터로 초기화하시겠습니까?")) return;
    const colRef = collection(db, 'reservations');
    const snap = await getDocs(colRef);
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    INITIAL_DATA.forEach(data => batch.set(doc(colRef), { ...data, createdAt: serverTimestamp() }));
    await batch.commit();
    showMsg("데이터가 초기화되었습니다.", "success");
  };

  // --- UI 구성 ---
  if (!isUnlocked) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white p-10 rounded-[2.5rem] shadow-2xl text-center">
        <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center text-blue-600 mx-auto mb-6"><Lock size={36}/></div>
        <h1 className="text-2xl font-black mb-8">관리자 로그인</h1>
        <form onSubmit={handleLogin} className="space-y-4">
          <input type="password" value={pinInput} onChange={e => setPinInput(e.target.value)} className="w-full p-4 text-center text-3xl font-black bg-slate-50 border-2 rounded-2xl outline-none" placeholder="PIN" autoFocus />
          <button type="submit" className="w-full p-4 bg-blue-600 text-white font-black rounded-2xl shadow-lg">시스템 접속</button>
        </form>
      </div>
    </div>
  );

  if (loading) return <div className="h-screen flex items-center justify-center font-black text-slate-400">데이터 로드 중...</div>;

  return (
    <div className="flex flex-col md:flex-row h-screen bg-slate-50 overflow-hidden font-sans">
      {message && <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[1000] px-8 py-3 rounded-full shadow-2xl bg-slate-900 text-white font-bold">{message.text}</div>}

      <nav className="w-full md:w-72 border-r border-slate-200 flex md:flex-col p-6 space-y-3 bg-white shadow-xl shrink-0">
        <div className="hidden md:block p-8 bg-blue-600 text-white rounded-[2rem] mb-6 shadow-lg">
          <BedDouble size={32} className="mb-4" />
          <h1 className="font-black text-2xl uppercase">Shell<br/>Beach</h1>
        </div>
        {['calendar', 'add', 'search', 'stats'].map(id => (
          <button key={id} onClick={() => setActiveTab(id)} className={`flex items-center gap-4 p-4 rounded-2xl font-bold transition-all ${activeTab === id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
            {id === 'calendar' && <Calendar size={20}/>}
            {id === 'add' && <PlusCircle size={20}/>}
            {id === 'search' && <Search size={20}/>}
            {id === 'stats' && <BarChart3 size={20}/>}
            <span className="capitalize">{id === 'calendar' ? '현황판' : id === 'add' ? '등록' : id === 'search' ? '검색' : '통계'}</span>
          </button>
        ))}
        <button onClick={resetData} className="mt-auto flex items-center gap-4 p-4 rounded-2xl font-bold text-rose-500 hover:bg-rose-50 transition-all"><RefreshCw size={20}/> 데이터 초기화</button>
      </nav>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        {activeTab === 'calendar' && (
          <div className="max-w-[1400px] mx-auto space-y-6">
            <header className="flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200">
              <h2 className="text-2xl font-black">{viewDate.getFullYear()}년 {viewDate.getMonth() + 1}월</h2>
              <div className="flex gap-2 bg-slate-50 p-2 rounded-2xl">
                <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))} className="p-2 hover:bg-white rounded-xl"><ChevronLeft/></button>
                <button onClick={() => setViewDate(new Date())} className="px-4 font-bold text-sm text-blue-600">오늘</button>
                <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))} className="p-2 hover:bg-white rounded-xl"><ChevronRight/></button>
              </div>
            </header>
            
            <div className="grid grid-cols-7 bg-white rounded-[2rem] shadow-xl overflow-hidden border border-slate-200">
              {['일','월','화','수','목','금','토'].map((d, i) => (
                <div key={d} className={`p-4 text-center text-xs font-black bg-slate-50 border-b border-slate-100 ${i === 0 ? 'text-rose-500' : i === 6 ? 'text-blue-500' : 'text-slate-400'}`}>{d}</div>
              ))}
              {Array.from({ length: 42 }).map((_, i) => {
                const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
                const day = i - firstDay + 1;
                const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
                const dateStr = day > 0 && day <= daysInMonth ? `${viewDate.getFullYear()}-${String(viewDate.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}` : null;
                const dayRes = dateStr ? (reservationMap[dateStr] || []) : [];
                
                return (
                  <div key={i} onClick={() => dateStr && (setFormData({...formData, date: dateStr}), setIsModalOpen(true))} className={`min-h-[120px] p-2 md:p-4 border-r border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors ${!dateStr ? 'bg-slate-50/30' : ''}`}>
                    {dateStr && (
                      <>
                        <span className={`text-lg font-black ${new Date(dateStr).getDay() === 0 ? 'text-rose-500' : new Date(dateStr).getDay() === 6 ? 'text-blue-500' : 'text-slate-600'}`}>{day}</span>
                        <div className="mt-2 space-y-1">
                          {dayRes.map((r, idx) => (
                            <div key={idx} className={`text-[10px] p-1.5 rounded-lg border font-bold truncate ${ROOMS.find(rm => rm.id === r.room)?.color}`}>
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

        {activeTab === 'stats' && (
          <div className="max-w-6xl mx-auto space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-slate-900 p-8 rounded-3xl text-white">
                <p className="text-blue-300 font-bold text-sm">2026 누적 매출</p>
                <p className="text-4xl font-black mt-2">₩{stats.revenue.toLocaleString()}</p>
              </div>
              <div className="bg-white p-8 rounded-3xl border border-slate-200">
                <p className="text-slate-500 font-bold text-sm">총 예약</p>
                <p className="text-4xl font-black mt-2">{stats.count}건</p>
              </div>
            </div>
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 overflow-x-auto">
              <h4 className="font-black text-xl mb-6">월별 상세 매출 내역</h4>
              <table className="w-full text-left min-w-[600px]">
                <thead><tr className="border-b-2 text-slate-400 text-sm"><th className="py-4">월</th><th>Shell</th><th>Beach</th><th>Pine</th><th>합계</th></tr></thead>
                <tbody>
                  {stats.monthlyRoomStats.map((s, i) => (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="py-4 font-bold">{i+1}월</td>
                      <td>₩{s.Shell.toLocaleString()}</td>
                      <td>₩{s.Beach.toLocaleString()}</td>
                      <td>₩{s.Pine.toLocaleString()}</td>
                      <td className="font-black text-blue-600">₩{s.total.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {isModalOpen && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsModalOpen(false)}>
          <div className="bg-white w-full max-w-2xl rounded-[2.5rem] p-8 md:p-10 relative overflow-y-auto max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <button onClick={() => setIsModalOpen(false)} className="absolute top-6 right-6 p-2 bg-slate-100 rounded-full"><X/></button>
            <h3 className="text-2xl font-black mb-1">{formData.date} 현황</h3>
            <p className="text-blue-600 font-bold mb-8">예약 내역 및 등록</p>
            
            <div className="mb-10 space-y-3">
              {(reservationMap[formData.date] || []).map((r, i) => (
                <div key={i} className={`p-4 rounded-2xl border flex justify-between items-center ${ROOMS.find(rm => rm.id === r.room)?.color}`}>
                  <span className="font-black">{r.room} | {r.name}님</span>
                  <button onClick={() => handleDelete(r.id)} className="text-rose-500 p-2 hover:bg-rose-100 rounded-xl"><Trash2 size={18}/></button>
                </div>
              ))}
            </div>

            <form onSubmit={handleSave} className="space-y-4 pt-6 border-t">
              <div className="grid grid-cols-3 gap-2">
                {ROOMS.map(r => (
                  <button key={r.id} type="button" onClick={() => setFormData({...formData, room: r.id})} className={`p-3 rounded-xl font-bold border-2 ${formData.room === r.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white'}`}>{r.name}</button>
                ))}
              </div>
              <input type="text" placeholder="예약자 성함" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full p-4 bg-slate-50 rounded-2xl font-bold border-none outline-none focus:ring-2 ring-blue-500" required />
              <button type="submit" className="w-full p-5 bg-slate-900 text-white font-black rounded-2xl shadow-xl">예약 확정 (₩{totalPrice.toLocaleString()})</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}