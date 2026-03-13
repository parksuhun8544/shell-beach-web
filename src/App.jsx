import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, onSnapshot, 
  serverTimestamp, deleteDoc, doc, getDocs
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged 
} from 'firebase/auth';
import { 
  Calendar, PlusCircle, BarChart3, ChevronLeft, 
  ChevronRight, BedDouble, CheckCircle2, AlertCircle,
  X, TrendingUp, Users, Wallet, Trash2, UserCircle2, Download
} from 'lucide-react';

// --- 1. 가격 정책 및 객실 설정 ---
const PRICING = {
  low: { Shell: [100000, 120000], Beach: [180000, 220000], Pine: [220000, 400000] },
  high: { Shell: [120000, 140000], Beach: [220000, 250000], Pine: [250000, 450000] }
};

const ROOMS = [
  { id: 'Shell', name: 'Shell (쉘)', color: 'bg-pink-100 text-pink-700 border-pink-200', dot: 'bg-pink-500' },
  { id: 'Beach', name: 'Beach (비치)', color: 'bg-blue-100 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
  { id: 'Pine', name: 'Pine (파인)', color: 'bg-teal-100 text-teal-700 border-teal-200', dot: 'bg-teal-500' }
];

// --- 2. 제공된 PDF/CSV 데이터 기반 기초 데이터 ---
const SEED_DATA = [
  // 1월
  { date: '2026-01-01', room: 'Shell', name: '염준돈', phone: '', path: '여기어때', nights: 1, price: 120000 },
  { date: '2026-01-01', room: 'Pine', name: '손미향', phone: '', path: '떠나요', nights: 1, price: 220000 },
  { date: '2026-01-02', room: 'Pine', name: '박정아', phone: '010-6888-2804', path: '네이버펜션', nights: 2, price: 480000 },
  { date: '2026-01-03', room: 'Shell', name: '이태훈', phone: '', path: '떠나요', nights: 1, price: 120000 },
  { date: '2026-01-03', room: 'Beach', name: '임정아', phone: '010-3678-0953', path: '네이버플레이스', nights: 1, price: 220000 },
  { date: '2026-01-10', room: 'Beach', name: '황진혁', phone: '010-3889-0176', path: '네이버지도', nights: 1, price: 220000 },
  { date: '2026-01-10', room: 'Pine', name: '정희나', phone: '', path: '여기어때', nights: 1, price: 400000 },
  { date: '2026-01-11', room: 'Beach', name: '허소영', phone: '', path: '여기어때', nights: 1, price: 180000 },
  { date: '2026-01-11', room: 'Pine', name: '김지호', phone: '010-8661-5843', path: '네이버지도', nights: 1, price: 220000 },
  { date: '2026-01-16', room: 'Beach', name: '류희철', phone: '010-9010-7758', path: '네이버지도', nights: 1, price: 180000 },
  { date: '2026-01-17', room: 'Shell', name: '신원균', phone: '010-5634-5527', path: '네이버지도', nights: 1, price: 120000 },
  { date: '2026-01-17', room: 'Pine', name: '민경복', phone: '', path: '떠나요', nights: 1, price: 400000 },
  { date: '2026-01-22', room: 'Beach', name: '최미선', phone: '', path: '여기어때', nights: 2, price: 400000 },
  { date: '2026-01-24', room: 'Shell', name: '이지', phone: '', path: '여기어때', nights: 1, price: 120000 },
  { date: '2026-01-24', room: 'Beach', name: '이하은', phone: '', path: '여기어때', nights: 1, price: 220000 },
  { date: '2026-01-24', room: 'Pine', name: '김현정', phone: '', path: '여기어때', nights: 1, price: 400000 },
  { date: '2026-01-25', room: 'Shell', name: '진혜령', phone: '', path: '떠나요', nights: 1, price: 100000 },
  { date: '2026-01-25', room: 'Beach', name: '문성권', phone: '', path: '여기어때', nights: 1, price: 180000 },
  { date: '2026-01-31', room: 'Shell', name: '이광혁', phone: '', path: '여기어때', nights: 1, price: 120000 },
  { date: '2026-01-31', room: 'Beach', name: '김태진', phone: '010-9498-4844', path: '홈페이지', nights: 1, price: 220000 },
  { date: '2026-01-31', room: 'Pine', name: '김혜영', phone: '010-4179-6875', path: '네이버지도', nights: 1, price: 420000 },
  // 2월
  { date: '2026-02-06', room: 'Pine', name: '박세진', phone: '010-2759-3827', path: '네이버플레이스', nights: 1, price: 220000 },
  { date: '2026-02-07', room: 'Shell', name: '고명현', phone: '', path: '떠나요', nights: 1, price: 120000 },
  { date: '2026-02-07', room: 'Beach', name: '강보미', phone: '', path: '여기어때', nights: 1, price: 220000 },
  { date: '2026-02-07', room: 'Pine', name: '박진웅', phone: '', path: '떠나요', nights: 1, price: 400000 },
  { date: '2026-02-08', room: 'Pine', name: '김성운', phone: '', path: '여기어때', nights: 1, price: 220000 },
  { date: '2026-02-14', room: 'Shell', name: '김주호', phone: '010-3213-0905', path: '네이버펜션', nights: 2, price: 255000 },
  { date: '2026-02-14', room: 'Beach', name: '허진보', phone: '010-9660-7799', path: '네이버지도', nights: 1, price: 220000 },
  { date: '2026-02-14', room: 'Pine', name: '한행륜', phone: '', path: '여기어때', nights: 1, price: 400000 },
  { date: '2026-02-15', room: 'Beach', name: 'JINHUA', phone: '010-9136-6898', path: '떠나요', nights: 1, price: 220000 },
  { date: '2026-02-15', room: 'Pine', name: '이진우', phone: '010-3430-0999', path: '네이버펜션', nights: 1, price: 400000 },
  { date: '2026-02-16', room: 'Shell', name: 'JINGUANGZH', phone: '010-7322-8732', path: '떠나요', nights: 1, price: 120000 },
  { date: '2026-02-16', room: 'Beach', name: '박기태', phone: '', path: '여기어때', nights: 1, price: 220000 },
  { date: '2026-02-17', room: 'Beach', name: '최선희', phone: '', path: '여기어때', nights: 2, price: 400000 },
  { date: '2026-02-21', room: 'Beach', name: 'Dongkyun J', phone: '', path: '떠나요', nights: 1, price: 220000 },
  { date: '2026-02-22', room: 'Pine', name: '최춘경', phone: '010-3682-3117', path: '네이버플레이스', nights: 1, price: 20000 },
  { date: '2026-02-27', room: 'Shell', name: '김승윤', phone: '', path: '여기어때', nights: 1, price: 100000 },
  { date: '2026-02-28', room: 'Shell', name: '박미선', phone: '010-5263-1253', path: '네이버펜션', nights: 2, price: 240000 },
  { date: '2026-02-28', room: 'Beach', name: '조민지', phone: '010-5641-5280', path: '네이버플레이스', nights: 1, price: 240000 },
  { date: '2026-02-28', room: 'Pine', name: '김지섭', phone: '010-9913-2660', path: '네이버플레이스', nights: 1, price: 400000 },
  // 3월
  { date: '2026-03-01', room: 'Shell', name: '박미선', phone: '010-5263-1263', path: '네이버펜션', nights: 1, price: 120000 },
  { date: '2026-03-01', room: 'Beach', name: '장선희', phone: '', path: '여기어때', nights: 1, price: 220000 },
  { date: '2026-03-07', room: 'Shell', name: '이주희', phone: '', path: '떠나요', nights: 1, price: 120000 },
  { date: '2026-03-07', room: 'Beach', name: '추연희', phone: '', path: '여기어때', nights: 1, price: 220000 },
  { date: '2026-03-07', room: 'Pine', name: '배윤혜', phone: '', path: '떠나요', nights: 1, price: 400000 },
  { date: '2026-03-14', room: 'Shell', name: '송성진', phone: '010-2721-5927', path: '네이버펜션', nights: 1, price: 120000 },
  { date: '2026-03-14', room: 'Beach', name: '이호재', phone: '010-7652-4666', path: '직접', nights: 1, price: 220000 },
  { date: '2026-03-17', room: 'Pine', name: '이민호', phone: '', path: '여기어때', nights: 1, price: 220000 },
  { date: '2026-03-18', room: 'Pine', name: '원재', phone: '', path: '직접', nights: 1, price: 220000 },
  { date: '2026-03-21', room: 'Beach', name: '안성훈', phone: '010-2003-3451', path: '떠나요', nights: 1, price: 220000 },
  { date: '2026-03-22', room: 'Shell', name: '박수헌', phone: '', path: '직접', nights: 2, price: 240000 },
  { date: '2026-03-28', room: 'Shell', name: '박광수', phone: '010-8767-6574', path: '네이버지도', nights: 1, price: 120000 },
  // 4월
  { date: '2026-04-04', room: 'Beach', name: '강홍석', phone: '010-2655-4359', path: '네이버플레이스', nights: 1, price: 260000 },
  { date: '2026-04-04', room: 'Pine', name: '박준하', phone: '010-4916-5910', path: '네이버플레이스', nights: 1, price: 415000 },
  { date: '2026-04-12', room: 'Pine', name: '엄마지인', phone: '', path: '직접', nights: 1, price: 220000 },
  { date: '2026-04-17', room: 'Beach', name: 'YUN SANG J', phone: '', path: '떠나요', nights: 1, price: 180000 },
  { date: '2026-04-18', room: 'Pine', name: '김샘', phone: '', path: '떠나요', nights: 1, price: 400000 },
  { date: '2026-04-24', room: 'Beach', name: '최랑희', phone: '010-9688-6809', path: '네이버플레이스', nights: 2, price: 400000 },
  { date: '2026-04-25', room: 'Pine', name: '박기태', phone: '', path: '여기어때', nights: 1, price: 400000 },
  // 5월
  { date: '2026-05-15', room: 'Beach', name: '박인희', phone: '010-4830-7024', path: '네이버지도', nights: 2, price: 590000 },
  { date: '2026-05-23', room: 'Beach', name: '이현자', phone: '', path: '여기어때', nights: 2, price: 600000 },
  // 7월
  { date: '2026-07-13', room: 'Pine', name: '천정봉', phone: '', path: '여기어때', nights: 1, price: 300000 },
];

// --- 3. 파이어베이스 초기 설정 ---
const firebaseConfig = JSON.parse(__firebase_config);
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'shell-beach-final-v3';

export default function App() {
  const [user, setUser] = useState(null);
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('calendar');
  const [viewDate, setViewDate] = useState(new Date(2026, 0, 1));
  const [message, setMessage] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [formData, setFormData] = useState({
    date: '2026-01-01', room: 'Shell', name: '', phone: '', 
    adults: 0, kids: 0, bbq: 0, nights: 1, memo: ''
  });

  // --- 4. 데이터 실시간 동기화 ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) { console.error(e); }
    };
    initAuth();

    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        const q = collection(db, 'artifacts', appId, 'public', 'data', 'reservations');
        return onSnapshot(q, (snap) => {
          setReservations(snap.docs.map(d => ({ id: d.id, ...d.data() })));
          setLoading(false);
        }, () => setLoading(false));
      }
    });
  }, []);

  // --- 5. 연박 로직 (날짜별 맵핑) ---
  const reservationMap = useMemo(() => {
    const map = {};
    reservations.forEach(res => {
      const startDate = new Date(res.date);
      for (let i = 0; i < (res.nights || 1); i++) {
        const targetDate = new Date(startDate);
        targetDate.setDate(startDate.getDate() + i);
        const dateStr = targetDate.toISOString().split('T')[0];
        if (!map[dateStr]) map[dateStr] = [];
        map[dateStr].push(res);
      }
    });
    return map;
  }, [reservations]);

  const stats = useMemo(() => {
    const totalRevenue = reservations.reduce((sum, r) => sum + (Number(r.price) || 0), 0);
    const roomStats = ROOMS.reduce((acc, room) => {
      const roomRes = reservations.filter(r => r.room === room.id);
      acc[room.id] = {
        count: roomRes.length,
        revenue: roomRes.reduce((sum, r) => sum + (Number(r.price) || 0), 0)
      };
      return acc;
    }, {});
    return { totalRevenue, roomStats, totalCount: reservations.length };
  }, [reservations]);

  const totalPrice = useMemo(() => {
    if (!formData.date) return 0;
    const d = new Date(formData.date);
    const isHigh = d.getMonth() >= 4;
    let total = 0;
    for(let i=0; i < formData.nights; i++) {
        const current = new Date(d);
        current.setDate(d.getDate() + i);
        const isWeekend = current.getDay() === 5 || current.getDay() === 6;
        const rates = isHigh ? PRICING.high[formData.room] : PRICING.low[formData.room];
        total += rates[isWeekend ? 1 : 0];
    }
    const extra = (formData.adults * 20000 + formData.kids * 15000 + formData.bbq * 30000) * formData.nights;
    return total + extra;
  }, [formData]);

  // --- 6. 핸들러 ---
  const importData = async () => {
    if (!window.confirm("제공된 1~5월 장부 데이터를 서버로 복구하시겠습니까?")) return;
    setLoading(true);
    const col = collection(db, 'artifacts', appId, 'public', 'data', 'reservations');
    try {
      for (const item of SEED_DATA) {
        await addDoc(col, { ...item, createdAt: serverTimestamp() });
      }
      showMsg("장부 데이터 복구 성공", "success");
    } catch (e) { showMsg("오류 발생", "error"); }
    setLoading(false);
  };

  const handleDateClick = (dateStr) => {
    setFormData({ ...formData, date: dateStr, name: '', phone: '', memo: '', adults: 0, kids: 0, bbq: 0, nights: 1 });
    setIsModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!user) return;
    try {
      const col = collection(db, 'artifacts', appId, 'public', 'data', 'reservations');
      await addDoc(col, { ...formData, price: totalPrice, createdAt: serverTimestamp() });
      showMsg("저장 완료", "success");
      setIsModalOpen(false);
    } catch (e) { showMsg("실패", "error"); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("삭제하시겠습니까?")) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reservations', id));
  };

  const showMsg = (text, type) => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  if (loading) return <div className="h-screen flex items-center justify-center bg-white font-black animate-pulse">데이터 연결 중...</div>;

  return (
    <div className="flex flex-col md:flex-row h-screen bg-slate-50 text-slate-900 overflow-hidden font-sans">
      {/* 알림 */}
      {message && (
        <div className={`fixed top-10 left-1/2 -translate-x-1/2 z-[300] px-8 py-4 rounded-3xl shadow-2xl ${message.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          <span className="font-bold">{message.text}</span>
        </div>
      )}

      {/* 사이드바 */}
      <nav className="w-full md:w-72 border-r border-slate-200 flex md:flex-col p-6 space-x-2 md:space-x-0 md:space-y-3 bg-white">
        <div className="hidden md:flex p-6 bg-blue-600 text-white rounded-[2.5rem] mb-6 shadow-xl items-center gap-4">
          <BedDouble size={24} />
          <span className="font-black text-2xl tracking-tighter uppercase">Shell Beach</span>
        </div>
        
        <div className="hidden md:block mb-6 p-5 bg-slate-50 rounded-[2rem] border-2 border-dashed border-slate-200">
          <p className="text-[10px] font-black text-slate-400 mb-2 uppercase text-center">장부 복구</p>
          <button onClick={importData} className="w-full py-4 bg-white border border-slate-200 rounded-2xl flex items-center justify-center gap-2 text-sm font-black text-slate-600 hover:bg-blue-600 hover:text-white transition-all">
            <Download size={16} /> 기존 장부 가져오기
          </button>
        </div>

        {[
          { id: 'calendar', icon: Calendar, label: '현황판 (달력)' },
          { id: 'add', icon: PlusCircle, label: '신규 예약' },
          { id: 'stats', icon: BarChart3, label: '매출 분석' }
        ].map(item => (
          <button key={item.id} onClick={() => setActiveTab(item.id)}
            className={`flex-1 md:flex-none flex items-center justify-center md:justify-start gap-4 p-5 rounded-[1.8rem] transition-all ${activeTab === item.id ? 'bg-slate-900 text-white font-bold' : 'text-slate-400 hover:bg-slate-50'}`}>
            <item.icon size={22} /> <span className="hidden md:inline text-lg">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* 메인 콘텐츠 */}
      <main className="flex-1 overflow-auto p-4 md:p-8">
        {activeTab === 'calendar' && (
          <div className="max-w-7xl mx-auto space-y-6">
            <header className="flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
              <h2 className="text-4xl font-black">{viewDate.getFullYear()}년 {viewDate.getMonth() + 1}월</h2>
              <div className="flex gap-2 bg-slate-100 p-2 rounded-2xl">
                <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))} className="p-3 hover:bg-white rounded-xl transition-all"><ChevronLeft /></button>
                <button onClick={() => setViewDate(new Date())} className="px-6 py-2 font-black text-xs uppercase">Today</button>
                <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))} className="p-3 hover:bg-white rounded-xl transition-all"><ChevronRight /></button>
              </div>
            </header>
            
            <div className="grid grid-cols-7 border-2 border-slate-100 rounded-[3rem] overflow-hidden bg-white shadow-2xl shadow-slate-200/50">
              {['일','월','화','수','목','금','토'].map((d, i) => (
                <div key={d} className={`p-5 text-center text-xs font-black border-b border-slate-50 ${i === 0 ? 'text-red-500 bg-red-50/20' : i === 6 ? 'text-blue-500 bg-blue-50/20' : 'text-slate-300'}`}>{d}</div>
              ))}
              {Array.from({ length: 42 }).map((_, i) => {
                const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
                const day = i - firstDay + 1;
                const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
                const dateStr = day > 0 && day <= daysInMonth ? `${viewDate.getFullYear()}-${String(viewDate.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}` : null;
                const dayRes = dateStr ? (reservationMap[dateStr] || []) : [];
                
                return (
                  <div key={i} onClick={() => dateStr && handleDateClick(dateStr)}
                    className={`min-h-32 md:min-h-40 p-3 border-r border-b border-slate-50 last:border-r-0 hover:bg-blue-50/30 cursor-pointer ${!dateStr ? 'bg-slate-50/10' : 'bg-white'}`}>
                    {dateStr && (
                      <>
                        <span className={`text-base font-black ${new Date(dateStr).getDay() === 0 ? 'text-red-500' : new Date(dateStr).getDay() === 6 ? 'text-blue-500' : 'text-slate-300'}`}>{day}</span>
                        <div className="mt-2 space-y-1">
                          {dayRes.map(r => (
                            <div key={`${r.id}-${dateStr}`} className={`text-[10px] p-2 rounded-xl border-2 font-black truncate shadow-sm flex items-center gap-1.5 ${ROOMS.find(rm => rm.id === r.room)?.color}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${ROOMS.find(rm => rm.id === r.room)?.dot}`}></span>
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
        )}

        {activeTab === 'add' && (
          <div className="max-w-2xl mx-auto py-10">
             <div className="bg-white p-12 rounded-[4rem] shadow-xl border border-slate-100">
                <h3 className="text-3xl font-black mb-10 flex items-center gap-3"><PlusCircle className="text-blue-600" /> 신규 예약</h3>
                <form onSubmit={handleSave} className="space-y-8">
                  <div className="grid grid-cols-2 gap-6">
                    <input type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="p-6 bg-slate-50 rounded-3xl font-black outline-none focus:ring-4 ring-blue-100" required />
                    <select value={formData.nights} onChange={e => setFormData({...formData, nights: Number(e.target.value)})} className="p-6 bg-slate-50 rounded-3xl font-black outline-none appearance-none">
                      {[1,2,3,4,5,6,7].map(n => <option key={n} value={n}>{n}박 숙박</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {ROOMS.map(r => (
                      <button key={r.id} type="button" onClick={() => setFormData({...formData, room: r.id})} className={`p-6 rounded-3xl font-black border-4 transition-all ${formData.room === r.id ? 'bg-slate-900 text-white border-slate-200' : 'bg-slate-50 border-transparent text-slate-400'}`}>{r.id}</button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <input type="text" placeholder="성함" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="p-6 bg-slate-50 rounded-3xl font-black" required />
                    <input type="tel" placeholder="연락처" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="p-6 bg-slate-50 rounded-3xl font-black" required />
                  </div>
                  <div className="p-10 bg-blue-600 rounded-[3rem] text-white flex justify-between items-center shadow-2xl shadow-blue-200">
                    <div><p className="text-xs font-black opacity-60">총 결제액</p><p className="text-4xl font-black mt-1">{totalPrice.toLocaleString()}원</p></div>
                    <button type="submit" className="px-12 py-5 bg-white text-blue-600 rounded-3xl font-black text-xl hover:scale-105 transition-all">등록하기</button>
                  </div>
                </form>
             </div>
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="max-w-7xl mx-auto space-y-10">
             <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
               <div className="bg-white p-12 rounded-[4rem] shadow-xl border border-slate-50">
                  <p className="text-slate-400 font-black text-xs uppercase tracking-widest">누적 매출</p>
                  <p className="text-5xl font-black text-slate-900 mt-4 tracking-tighter">{stats.totalRevenue.toLocaleString()}원</p>
               </div>
               <div className="bg-white p-12 rounded-[4rem] shadow-xl border border-slate-50">
                  <p className="text-slate-400 font-black text-xs uppercase tracking-widest">총 예약</p>
                  <p className="text-5xl font-black text-slate-900 mt-4 tracking-tighter">{stats.totalCount}건</p>
               </div>
               <div className="bg-white p-12 rounded-[4rem] shadow-xl border border-slate-50">
                  <p className="text-slate-400 font-black text-xs uppercase tracking-widest">평균 단가</p>
                  <p className="text-5xl font-black text-teal-600 mt-4 tracking-tighter">{(stats.totalCount ? Math.round(stats.totalRevenue/stats.totalCount) : 0).toLocaleString()}원</p>
               </div>
             </div>
          </div>
        )}
      </main>

      {/* 팝업 모달 */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xl">
          <div className="bg-white w-full max-w-2xl rounded-[4rem] shadow-2xl p-12 relative overflow-y-auto max-h-[90vh]">
            <button onClick={() => setIsModalOpen(false)} className="absolute top-10 right-10 p-3 bg-slate-100 rounded-2xl"><X size={24} /></button>
            <h3 className="text-4xl font-black tracking-tight mb-2 italic">Dashboard</h3>
            <p className="text-blue-600 font-black text-xl mb-10">{formData.date} 현황</p>

            {/* 기존 명단 */}
            <div className="mb-12 space-y-4">
              <h4 className="text-xs font-black text-slate-400 flex items-center gap-2 uppercase tracking-widest"><UserCircle2 size={16} /> 기존 예약자</h4>
              {(reservationMap[formData.date] || []).length > 0 ? (
                reservationMap[formData.date].map(r => (
                  <div key={r.id} className={`p-6 rounded-[2.5rem] border-2 flex justify-between items-center ${ROOMS.find(rm => rm.id === r.room)?.color}`}>
                    <div><p className="font-black text-xl">{r.room} - {r.name}님</p><p className="text-xs font-bold opacity-60 mt-1">{r.phone || '연락처 없음'} / {r.nights}박</p></div>
                    <button onClick={() => handleDelete(r.id)} className="p-4 bg-white/50 rounded-2xl text-red-600 hover:bg-red-600 hover:text-white transition-all"><Trash2 size={20} /></button>
                  </div>
                ))
              ) : (
                <div className="p-10 bg-slate-50 rounded-[2.5rem] text-center font-bold text-slate-300">비어있음</div>
              )}
            </div>

            {/* 입력 폼 */}
            <div className="pt-10 border-t-4 border-dashed border-slate-50">
              <h4 className="text-xs font-black text-blue-600 mb-6 uppercase tracking-widest">새 손님 추가</h4>
              <form onSubmit={handleSave} className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  {ROOMS.map(r => {
                    const isFull = (reservationMap[formData.date] || []).some(res => res.room === r.id);
                    return (
                      <button key={r.id} type="button" disabled={isFull} onClick={() => setFormData({...formData, room: r.id})} className={`p-6 rounded-3xl font-black border-4 transition-all ${isFull ? 'opacity-10 grayscale cursor-not-allowed' : formData.room === r.id ? 'bg-blue-600 text-white border-blue-200' : 'bg-slate-50 border-transparent text-slate-400'}`}>
                        {r.id} {isFull && '만실'}
                      </button>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <select value={formData.nights} onChange={e => setFormData({...formData, nights: Number(e.target.value)})} className="p-5 bg-slate-50 rounded-3xl font-bold">
                    {[1,2,3,4,5,6,7].map(n => <option key={n} value={n}>{n}박 숙박</option>)}
                  </select>
                  <input type="text" placeholder="성함" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="p-5 bg-slate-50 rounded-3xl font-bold" required />
                </div>
                <div className="p-10 bg-slate-900 rounded-[3.5rem] text-white flex justify-between items-center mt-8 shadow-2xl shadow-blue-900/20">
                  <div><p className="text-[10px] text-slate-500 font-black">Total</p><p className="text-4xl font-black text-blue-400">{totalPrice.toLocaleString()}원</p></div>
                  <button type="submit" className="px-12 py-5 bg-blue-600 rounded-3xl font-black text-lg">확정하기</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
