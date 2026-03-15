import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, addDoc, onSnapshot,
  serverTimestamp, deleteDoc, doc, updateDoc, getDocs, writeBatch
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  Calendar, PlusCircle, BarChart3, ChevronLeft,
  ChevronRight, BedDouble, X, TrendingUp, Users, Wallet, Trash2,
  Search, Check, TableProperties, Lock, Phone
} from 'lucide-react';

// --- 1. 공휴일 및 요금 로직 ---
const HOLIDAYS = new Set([
  '2026-01-01','2026-01-28','2026-01-29','2026-01-30',
  '2026-03-01','2026-03-02','2026-05-05','2026-05-25',
  '2026-06-03','2026-06-06','2026-06-08',
  '2026-08-15','2026-08-17',
  '2026-09-24','2026-09-25','2026-09-26','2026-09-28',
  '2026-10-03','2026-10-05','2026-10-09','2026-12-25',
]);

const isWeekendPrice = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay(); // 0=일,1=월,...,5=금,6=토
  const nxt = new Date(d);
  nxt.setDate(d.getDate() + 1);
  const ns = `${nxt.getFullYear()}-${String(nxt.getMonth()+1).padStart(2,'0')}-${String(nxt.getDate()).padStart(2,'0')}`;
  if (dow === 6) return true;                                      // 규칙1: 토요일
  if (HOLIDAYS.has(ns) && nxt.getDay() !== 6) return true;        // 규칙2: 다음날 공휴일 (토요일 공휴일 제외)
  if (dow === 5 && HOLIDAYS.has(dateStr)) return true;             // 규칙3: 공휴일인 금요일
  return false;
};

const getPricePerNight = (room, dateStr) => {
  const [y,m,d] = dateStr.split('-').map(Number);
  const mmdd = m * 100 + d;
  const dt = new Date(dateStr + 'T00:00:00');
  const isFri = dt.getDay() === 5;
  const wk = isWeekendPrice(dateStr);

  if (mmdd >= 715 && mmdd <= 825)
    return { Shell:140000, Beach:300000, Pine:450000 }[room];
  if (mmdd >= 701 && mmdd <= 714 && room === 'Beach' && isFri)
    return 250000;
  if (mmdd >= 701 && mmdd <= 714)
    return { Shell:[120000,140000], Beach:[220000,300000], Pine:[300000,450000] }[room][wk?1:0];
  if (mmdd >= 501 && mmdd <= 630)
    return { Shell:[120000,140000], Beach:[220000,300000], Pine:[250000,450000] }[room][wk?1:0];
  return { Shell:[100000,120000], Beach:[180000,220000], Pine:[220000,400000] }[room][wk?1:0];
};

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
const dateStrToObj = (ds) => {
  const [y,m,d] = ds.split('-').map(Number);
  return new Date(y, m-1, d);
};
const addDays = (ds, n) => {
  const [y,m,d] = ds.split('-').map(Number);
  const dt = new Date(y, m-1, d+n);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
};

export default function App() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('calendar');
  const [viewDate, setViewDate] = useState(new Date());
  const [message, setMessage] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [exitConfirm, setExitConfirm] = useState(false);
  const [selectedResId, setSelectedResId] = useState(null); // 모달에서 선택된 예약 ID
  const [isManualPrice, setIsManualPrice] = useState(false);
  const [manualPrice, setManualPrice] = useState('');
  const [roomTouched, setRoomTouched] = useState(false); // 방 선택 여부
  const [formData, setFormData] = useState({
    date: getLocalTodayStr(), room:'Shell', name:'', phone:'010',
    adults:0, kids:0, bbq:false, nights:1, memo:'', path:'직접'
  });

  const showMsg = (text, type) => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  // PIN - sessionStorage 제거, 항상 새로 입력
  const handleLogin = (e) => {
    e.preventDefault();
    if (pinInput === '9631') {
      setIsUnlocked(true);
    } else {
      setPinError(true);
      setPinInput('');
    }
  };

  // Firebase init - isUnlocked 확정 후 1회만 실행
  useEffect(() => {
    if (!isUnlocked) return;
    let unsubSnapshot = null;
    const initApp = async () => {
      try {
        const currentUser = (await signInAnonymously(auth)).user;
        const colRef = collection(db,'reservations');
        const snap = await getDocs(colRef);
        if (snap.empty) {
          const batch = writeBatch(db);
          INITIAL_DATA.forEach(data => {
            batch.set(doc(colRef), { ...data, createdAt: serverTimestamp() });
          });
          await batch.commit();
        }
        // Firebase 초기화 완료 후 snapshot 구독 시작
        unsubSnapshot = onSnapshot(collection(db,'reservations'), (snap) => {
          setReservations(snap.docs.map(d => ({ id:d.id, ...d.data() })));
          setLoading(false);
        }, (e) => { console.error(e); setLoading(false); });
      } catch(e) { console.error(e); setLoading(false); }
    };
    initApp();
    return () => { if (unsubSnapshot) unsubSnapshot(); };
  }, [isUnlocked]);

  // 뒤로가기 - PIN 해제 후 1회 등록, ref로 최신 상태 참조
  const backStateRef = React.useRef({ isModalOpen, activeTab, exitConfirm, loading });
  useEffect(() => {
    backStateRef.current = { isModalOpen, activeTab, exitConfirm, loading };
  }, [isModalOpen, activeTab, exitConfirm, loading]);

  useEffect(() => {
    if (!isUnlocked) return;
    // history 스택에 현재 위치 고정
    window.history.pushState(null, '', window.location.href);
    const handleBack = () => {
      const s = backStateRef.current;
      // 로딩 중이면 차단
      if (s.loading) {
        window.history.pushState(null, '', window.location.href);
        return;
      }
      // 모달 열림 → 닫고 현황판
      if (s.isModalOpen) {
        setIsModalOpen(false);
        setEditTarget(null);
        setSelectedResId(null);
        setIsManualPrice(false);
        setManualPrice('');
        setRoomTouched(false);
        setActiveTab('calendar');
        window.history.pushState(null, '', window.location.href);
        return;
      }
      // 다른 탭 → 현황판
      if (s.activeTab !== 'calendar') {
        setActiveTab('calendar');
        window.history.pushState(null, '', window.location.href);
        return;
      }
      // 현황판 첫 번째 → 종료 메시지
      if (!s.exitConfirm) {
        setExitConfirm(true);
        setTimeout(() => setExitConfirm(false), 3000);
        window.history.pushState(null, '', window.location.href);
        return;
      }
      // 현황판 두 번째 → 종료 (history 조작 없이 실제 back)
      window.history.back();
    };
    window.addEventListener('popstate', handleBack);
    return () => window.removeEventListener('popstate', handleBack);
  }, [isUnlocked]);

  // reservationMap
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
    const monthlyRoomStats = Array(12).fill(null).map(() => ({ Shell:0, Beach:0, Pine:0, total:0 }));
    reservations.forEach(r => {
      if (!r.date || !r.room || !r.nights) return;
      const nights = r.nights || 1;
      const totalPrice = Number(r.price) || 0;
      // 1박당 요금 = 전체요금 / 박수 (균등 분배)
      const pricePerNight = Math.round(totalPrice / nights);
      revenue += totalPrice;
      for (let i = 0; i < nights; i++) {
        const ds = addDays(r.date, i);
        const [y, m] = ds.split('-');
        if (y === '2026') {
          const mIdx = Number(m) - 1;
          if (mIdx >= 0 && mIdx < 12) {
            monthlyRoomStats[mIdx][r.room] += pricePerNight;
            monthlyRoomStats[mIdx].total += pricePerNight;
          }
        }
      }
    });
    return { revenue, count:reservations.length, monthlyRoomStats };
  }, [reservations]);

  const totalPrice = useMemo(() => {
    if (!formData.date || !formData.room) return 0;
    let total = 0;
    for (let i = 0; i < formData.nights; i++) {
      total += getPricePerNight(formData.room, addDays(formData.date, i));
    }
    return total + (formData.adults*20000) + (formData.kids*15000) + (formData.bbq?30000:0);
  }, [formData]);

  const filteredReservations = useMemo(() => {
    if (!searchTerm) return [...reservations].sort((a,b) => a.date?.localeCompare(b.date));
    const s = searchTerm.toLowerCase();
    return reservations.filter(r => r.name?.includes(s) || r.phone?.includes(s));
  }, [reservations, searchTerm]);

  const handleSave = async (e) => {
    e.preventDefault();
    for (let i = 0; i < formData.nights; i++) {
      const ds = addDays(formData.date, i);
      if (isRoomFull(formData.room, ds, editTarget)) {
        showMsg("해당 기간에 이미 예약된 객실입니다.", "error");
        return;
      }
    }
    const finalPrice = isManualPrice ? (Number(manualPrice)||0) : totalPrice;
    try {
      if (editTarget) {
        await updateDoc(doc(db,'reservations',editTarget), { ...formData, price:finalPrice });
        showMsg("수정되었습니다.", "success");
        setEditTarget(null);
      } else {
        await addDoc(collection(db,'reservations'), { ...formData, price:finalPrice, createdAt:serverTimestamp() });
        showMsg("예약이 저장되었습니다.", "success");
      }
      setIsModalOpen(false);
      setSelectedResId(null);
      setIsManualPrice(false);
      setManualPrice('');
      setRoomTouched(false);
      if (activeTab==='add') setActiveTab('calendar');
    } catch(e) { showMsg("실패", "error"); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("삭제하시겠습니까?")) return;
    await deleteDoc(doc(db,'reservations',id));
    showMsg("삭제 완료", "success");
  };

  const migrateAllPrices = async () => {
    if (!window.confirm(`전체 ${reservations.length}건 가격을 현재 요금표 기준으로 재계산합니다.`)) return;
    setLoading(true);
    const batch = writeBatch(db);
    reservations.forEach(r => {
      if (!r.date||!r.room||!r.nights) return;
      let newPrice = 0;
      for (let i = 0; i < r.nights; i++) newPrice += getPricePerNight(r.room, addDays(r.date, i));
      batch.update(doc(db,'reservations',r.id), { price:newPrice });
    });
    await batch.commit();
    showMsg(`${reservations.length}건 가격 업데이트 완료`, 'success');
    setLoading(false);
  };

  const handlePhoneChange = (e) => {
    let val = e.target.value.replace(/[^0-9]/g,'');
    if (!val.startsWith('010')) val = '010' + val;
    setFormData({ ...formData, phone:val });
  };

  const renderForm = (isModal=false) => (
    <form onSubmit={handleSave} className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {ROOMS.map(r => {
          const full = isRoomFull(r.id, formData.date, editTarget);
          return (
            <button key={r.id} type="button" disabled={full}
              onClick={() => { setFormData({ ...formData, room:r.id }); setRoomTouched(true); }}
              className={`p-3 rounded-xl font-black border-2 transition-all flex flex-col items-center
                ${full ? 'bg-slate-50 border-slate-100 text-slate-300 opacity-50' :
                  formData.room===r.id ? 'bg-blue-600 text-white border-blue-600 shadow-md' :
                  'bg-white border-slate-100 text-slate-500 hover:border-blue-200'}`}>
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
            <input type="date" value={formData.date}
              onChange={e => setFormData({ ...formData, date:e.target.value })}
              className="p-3 bg-slate-50 rounded-xl font-bold border-none outline-none focus:ring-2 ring-blue-500 text-sm" required />
          </div>
        )}
        <div className="flex flex-col">
          <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1">숙박 일수</label>
          <select value={formData.nights}
            onChange={e => setFormData({ ...formData, nights:Number(e.target.value) })}
            className="p-3 bg-slate-50 rounded-xl font-bold border-none outline-none focus:ring-2 ring-blue-500 text-sm">
            {[1,2,3,4,5,6,7].map(n => <option key={n} value={n}>{n}박</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1">성함</label>
          <input type="text" placeholder="예약자명" value={formData.name}
            onChange={e => setFormData({ ...formData, name:e.target.value })}
            className="p-3 bg-slate-50 rounded-xl font-bold border-none outline-none focus:ring-2 ring-blue-500 text-sm" required />
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1">연락처</label>
          <input type="tel" placeholder="010-0000-0000" value={formatPhone(formData.phone)}
            onChange={handlePhoneChange}
            className="p-3 bg-slate-50 rounded-xl font-bold border-none outline-none focus:ring-2 ring-blue-500 text-sm" />
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1">예약 경로</label>
          <select value={formData.path}
            onChange={e => setFormData({ ...formData, path:e.target.value })}
            className="p-3 bg-slate-50 rounded-xl font-bold border-none outline-none focus:ring-2 ring-blue-500 text-sm">
            {PATHS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div className="bg-slate-50 p-4 rounded-2xl space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-slate-500 mb-1 ml-1">성인(8세~, 2만)</label>
            <input type="number" min="0" value={formData.adults}
              onChange={e => setFormData({ ...formData, adults:Number(e.target.value) })}
              className="p-2.5 rounded-xl border-none font-bold text-center text-sm" />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-slate-500 mb-1 ml-1">아동(~7세, 1.5만)</label>
            <input type="number" min="0" value={formData.kids}
              onChange={e => setFormData({ ...formData, kids:Number(e.target.value) })}
              className="p-2.5 rounded-xl border-none font-bold text-center text-sm" />
          </div>
        </div>
        <button type="button" onClick={() => setFormData({ ...formData, bbq:!formData.bbq })}
          className={`w-full p-2.5 rounded-xl font-bold border-2 text-xs transition-all
            ${formData.bbq ? 'bg-rose-500 text-white border-rose-500' : 'bg-white text-slate-400 border-slate-100'}`}>
          바베큐 그릴 (30,000원) {formData.bbq ? '신청완료' : '미신청'}
        </button>
      </div>
      <div className="space-y-2">
        {/* 예정요금 - 방 선택 후에만 표시 */}
        {roomTouched && (
          <div className="px-1 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400">예정 요금</span>
            <span className="text-base font-black text-slate-800">
              {isManualPrice
                ? `₩${(Number(manualPrice)||0).toLocaleString()} (직접입력)`
                : `₩${totalPrice.toLocaleString()}`}
            </span>
          </div>
        )}
        {/* 가격 직접입력 토글 */}
        {isManualPrice && (
          <div className="p-3 bg-amber-50 border-2 border-amber-300 rounded-xl flex items-center gap-3">
            <span className="text-xs font-bold text-amber-700 shrink-0">직접입력</span>
            <input
              type="number"
              value={manualPrice}
              onChange={e => setManualPrice(e.target.value)}
              placeholder="금액 입력"
              className="flex-1 bg-transparent border-b-2 border-amber-400 outline-none font-black text-amber-900 text-base placeholder-amber-300"
            />
            <span className="text-xs font-bold text-amber-600">원</span>
          </div>
        )}
        <div className="flex gap-2">
          <button type="button"
            onClick={() => {
              setIsManualPrice(!isManualPrice);
              setManualPrice(isManualPrice ? '' : String(totalPrice));
            }}
            className={`flex-1 py-3 rounded-xl font-bold text-xs transition-all border
              ${isManualPrice ? 'bg-amber-500 border-amber-400 text-white' : 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200'}`}>
            {isManualPrice ? '✏️ 직접입력 중' : '가격 직접입력'}
          </button>
          <button type="submit"
            className="flex-1 py-3 bg-blue-600 rounded-xl font-black text-sm text-white hover:bg-blue-500 transition-all shadow-lg">
            {editTarget ? "수정 완료" : "예약 저장"}
          </button>
        </div>
      </div>
    </form>
  );

  if (!isUnlocked) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white p-10 rounded-[2.5rem] shadow-2xl text-center">
        <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center text-blue-600 mx-auto mb-6">
          <Lock size={32} />
        </div>
        <h1 className="text-xl font-black text-slate-800 mb-6 tracking-tighter uppercase">Shell Beach Admin</h1>
        <form onSubmit={handleLogin} className="space-y-4">
          <input type="password" maxLength={4} value={pinInput}
            onChange={e => setPinInput(e.target.value)}
            className={`w-full p-4 text-center text-3xl font-black bg-slate-50 border-2 rounded-2xl outline-none
              ${pinError ? 'border-rose-400' : 'border-slate-100'}`}
            placeholder="PIN" autoFocus />
          {pinError && <p className="text-rose-500 text-xs font-bold">PIN이 올바르지 않습니다</p>}
          <button type="submit" className="w-full p-4 bg-blue-600 text-white font-black rounded-2xl shadow-lg">시스템 접속</button>
        </form>
      </div>
    </div>
  );

  const NAV_ITEMS = [
    { id:'calendar', icon:Calendar, label:'현황판' },
    { id:'add', icon:PlusCircle, label:'예약 등록' },
    { id:'search', icon:Search, label:'예약 검색' },
    { id:'stats', icon:BarChart3, label:'경영 통계' },
  ];

  return (
    <div className="flex flex-col md:flex-row h-screen bg-slate-50 font-sans">
      {/* 토스트 */}
      {message && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[1000] px-6 py-2.5 rounded-full shadow-2xl font-bold
          ${message.type==='success' ? 'bg-slate-900 text-white' : 'bg-rose-600 text-white'}`}>
          {message.text}
        </div>
      )}

      {/* 종료 확인 토스트 */}
      {exitConfirm && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[1000] px-6 py-2.5 rounded-full shadow-2xl font-bold bg-amber-500 text-white">
          종료하시겠습니까? 한 번 더 누르면 종료됩니다
        </div>
      )}

      {/* 데스크탑 사이드바 */}
      <nav className="hidden md:flex w-60 border-r border-slate-200 flex-col p-5 space-y-2 bg-white shadow-xl z-20 shrink-0">
        <div className="p-6 bg-blue-600 text-white rounded-[1.5rem] mb-4 shadow-xl">
          <BedDouble size={24} className="mb-3" />
          <h1 className="font-black text-lg uppercase tracking-tighter leading-none">Shell<br />Beach</h1>
          <div className="mt-3 text-[10px] bg-white/20 p-2 rounded-lg font-bold flex items-center gap-1.5">
            <Check size={10} /> 실시간 동기화 중
          </div>
        </div>
        {NAV_ITEMS.map(item => (
          <button key={item.id} onClick={() => setActiveTab(item.id)}
            className={`flex items-center gap-3 p-3.5 rounded-xl font-bold transition-all
              ${activeTab===item.id ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-100'}`}>
            <item.icon size={18} />
            <span className="text-sm">{item.label}</span>
          </button>
        ))}
        <button onClick={migrateAllPrices}
          className="mt-auto flex items-center gap-3 p-3.5 rounded-xl font-bold text-amber-600 hover:bg-amber-50 transition-all">
          <TrendingUp size={18} />
          <span className="text-sm">가격 일괄 재계산</span>
        </button>
      </nav>

      {/* 메인 */}
      <main className="flex-1 overflow-auto relative bg-slate-50 pb-20 md:pb-0">
        {loading && (
          <div className="absolute inset-0 z-50 bg-white/60 backdrop-blur-sm flex items-center justify-center font-black text-slate-400 text-sm tracking-widest uppercase">
            Syncing...
          </div>
        )}
        <div className="p-4 md:p-6 max-w-[1300px] mx-auto">

          {/* 현황판 */}
          {activeTab==='calendar' && (
            <div className="space-y-4">
              <header className="flex flex-col md:flex-row justify-between items-center bg-white p-4 md:p-5 rounded-[1.5rem] shadow-sm border border-slate-200">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-50 p-2.5 rounded-xl text-blue-600"><Calendar size={20} /></div>
                  <div>
                    <h2 className="text-xl font-black text-slate-800">{viewDate.getFullYear()}년 {viewDate.getMonth()+1}월</h2>
                    <p className="text-sm font-black text-blue-600 mt-0.5">
                      ₩{(stats.monthlyRoomStats[viewDate.getMonth()]?.total||0).toLocaleString()}
                      <span className="text-slate-400 font-bold text-xs ml-1">월 매출</span>
                    </p>
                  </div>
                </div>
                <div className="flex gap-1.5 bg-slate-100 p-1.5 rounded-xl mt-3 md:mt-0">
                  <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth()-1,1))}
                    className="p-1.5 hover:bg-white rounded-lg shadow-sm"><ChevronLeft size={18} /></button>
                  <button onClick={() => setViewDate(new Date())}
                    className="px-4 font-bold text-[11px] text-blue-600">오늘</button>
                  <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth()+1,1))}
                    className="p-1.5 hover:bg-white rounded-lg shadow-sm"><ChevronRight size={18} /></button>
                </div>
              </header>

              <div className="grid grid-cols-7 bg-white rounded-[1.5rem] shadow-lg overflow-hidden border border-slate-200/60">
                {['일','월','화','수','목','금','토'].map((d,i) => (
                  <div key={d} className={`p-2 text-center text-[10px] font-black border-b border-slate-100
                    ${i===0?'text-rose-500 bg-rose-50/20':i===6?'text-blue-500 bg-blue-50/20':'text-slate-400 bg-slate-50'}`}>{d}</div>
                ))}
                {Array.from({length:42}).map((_,i) => {
                  const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
                  const day = i - firstDay + 1;
                  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth()+1, 0).getDate();
                  const dateStr = day>0 && day<=daysInMonth
                    ? `${viewDate.getFullYear()}-${String(viewDate.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
                    : null;
                  const dayRes = dateStr ? (reservationMap[dateStr]||[]) : [];
                  return (
                    <div key={i}
                      onClick={() => {
                        if (!dateStr) return;
                        // 날짜 클릭 시 모든 상태 초기화
                        setFormData({ date:dateStr, room:'Shell', name:'', phone:'010',
                          adults:0, kids:0, bbq:false, nights:1, memo:'', path:'직접' });
                        setEditTarget(null);
                        setSelectedResId(null);
                        setIsManualPrice(false);
                        setManualPrice('');
                        setRoomTouched(false);
                        setIsModalOpen(true);
                      }}
                      className={`min-h-[80px] md:min-h-[110px] p-1.5 border-r border-b border-slate-100 cursor-pointer hover:bg-blue-50/20 transition-all
                        ${!dateStr?'bg-slate-50/30':'bg-white'}`}>
                      {dateStr && (
                        <>
                          <span className={`text-xs font-black
                            ${new Date(dateStr+'T00:00:00').getDay()===0?'text-rose-500':
                              new Date(dateStr+'T00:00:00').getDay()===6?'text-blue-500':'text-slate-600'}`}>{day}</span>
                          <div className="mt-1 space-y-0.5">
                            {dayRes.map((r,idx) => (
                              <div key={idx} className={`text-[8px] p-0.5 rounded-md border font-bold truncate flex items-center gap-0.5
                                ${ROOMS.find(rm=>rm.id===r.room)?.color||'bg-slate-100'}`}>
                                <div className={`w-1 h-1 rounded-full shrink-0 ${ROOMS.find(rm=>rm.id===r.room)?.dot||'bg-slate-300'}`}></div>
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

          {/* 예약 등록 */}
          {activeTab==='add' && (
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="bg-white p-6 md:p-10 rounded-[2rem] shadow-xl border border-slate-200">
                <h2 className="text-2xl font-black text-slate-800 mb-8 border-b pb-5 flex items-center gap-3">
                  <PlusCircle className="text-blue-600" /> 신규 예약 등록
                </h2>
                {renderForm(false)}
              </div>
            </div>
          )}

          {/* 예약 검색 */}
          {activeTab==='search' && (
            <div className="max-w-3xl mx-auto space-y-5">
              <h2 className="text-2xl font-black text-slate-800">예약 내역 검색</h2>
              <div className="relative">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <input type="text" placeholder="성함 또는 연락처 입력..."
                  className="w-full p-5 pl-14 bg-white border border-slate-200 rounded-2xl shadow-sm text-lg font-bold outline-none focus:ring-4 ring-blue-500/10 focus:border-blue-500"
                  value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
              </div>
              <div className="space-y-3">
                {filteredReservations.length > 0 ? filteredReservations.map(r => (
                  <div key={r.id} className="bg-white p-5 rounded-[1.5rem] border border-slate-100 flex flex-col md:flex-row justify-between md:items-center gap-4 shadow-sm hover:shadow-md transition-all border-l-4 border-l-blue-500">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg shrink-0
                        ${ROOMS.find(rm=>rm.id===r.room)?.color||'bg-slate-100'}`}>
                        {r.room?r.room[0]:'?'}
                      </div>
                      <div>
                        <p className="text-lg font-black text-slate-800">{r.name}님
                          <span className="text-[11px] font-bold text-blue-500 ml-2 px-2 py-0.5 bg-blue-50 rounded-md uppercase">{r.room}</span>
                        </p>
                        <p className="text-slate-500 font-bold mt-0.5 text-xs">{r.date} 입실 • {r.nights}박 • {r.path||'-'}</p>
                        {r.phone && (
                          <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1.5 mt-1.5 text-blue-600 font-bold hover:underline bg-blue-50 px-3 py-1 rounded-full text-[11px]">
                            <Phone size={11} /> {formatPhone(r.phone)}
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-between items-center md:flex-col md:items-end gap-1 border-t md:border-t-0 pt-3 md:pt-0">
                      <p className="text-xl font-black text-slate-900">₩{(Number(r.price)||0).toLocaleString()}</p>
                      <div className="flex gap-2">
                        <button onClick={() => {
                          setFormData({ date:r.date, room:r.room, name:r.name, phone:r.phone||'010',
                            adults:r.adults||0, kids:r.kids||0, bbq:r.bbq||false,
                            nights:r.nights||1, memo:r.memo||'', path:r.path||'직접' });
                          setEditTarget(r.id); setIsModalOpen(true);
                        }} className="text-blue-600 font-black text-[10px] px-3 py-1.5 bg-blue-50 rounded-lg hover:bg-blue-600 hover:text-white transition-all">수정</button>
                        <button onClick={() => handleDelete(r.id)}
                          className="text-rose-500 font-black text-[10px] px-3 py-1.5 bg-rose-50 rounded-lg hover:bg-rose-500 hover:text-white transition-all">삭제</button>
                      </div>
                    </div>
                  </div>
                )) : <div className="p-20 text-center text-slate-400 font-bold text-sm bg-white rounded-2xl border-2 border-dashed">검색 결과가 없습니다.</div>}
              </div>
            </div>
          )}

          {/* 경영 통계 */}
          {activeTab==='stats' && (
            <div className="max-w-5xl mx-auto space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-center">
                <div className="bg-slate-900 p-8 rounded-[1.5rem] text-white shadow-xl relative overflow-hidden">
                  <div className="absolute -right-4 -top-4 opacity-10"><Wallet size={100} /></div>
                  <p className="text-blue-300 font-bold text-xs">2026 누적 총 매출</p>
                  <p className="text-3xl font-black mt-2">₩{stats.revenue.toLocaleString()}</p>
                </div>
                <div className="bg-white p-8 rounded-[1.5rem] border border-slate-200 shadow-sm relative overflow-hidden">
                  <div className="absolute -right-4 -top-4 opacity-5"><Users size={100} /></div>
                  <p className="text-slate-500 font-bold text-xs">총 예약 건수</p>
                  <p className="text-3xl font-black mt-2 text-slate-800">{stats.count}건</p>
                </div>
              </div>
              <div className="bg-white p-6 md:p-8 rounded-[2rem] border border-slate-200 overflow-x-auto shadow-sm">
                <h4 className="font-black text-lg mb-6 flex items-center gap-2">
                  <TableProperties className="text-blue-600" size={18} /> 월별 상세 매출
                </h4>
                <table className="w-full text-left min-w-[520px]">
                  <thead>
                    <tr className="border-b-2 border-slate-100 text-slate-400 text-[11px] font-black uppercase">
                      <th className="py-4 pl-4">월</th><th>Shell</th><th>Beach</th><th>Pine</th>
                      <th className="py-4 pr-4 text-slate-900 text-right">합계</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs">
                    {stats.monthlyRoomStats.map((s,i) => (
                      <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50 ${s.total===0?'opacity-20':''}`}>
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

      {/* 모바일 하단 탭바 */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200 flex items-center justify-around px-2 py-1 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        {NAV_ITEMS.map(item => (
          <button key={item.id} onClick={() => setActiveTab(item.id)}
            className={`flex flex-col items-center justify-center gap-1 flex-1 py-2 rounded-xl transition-all
              ${activeTab===item.id?'text-blue-600':'text-slate-400'}`}>
            <item.icon size={22} strokeWidth={activeTab===item.id?2.5:1.8} />
            <span className={`text-[10px] font-black ${activeTab===item.id?'text-blue-600':'text-slate-400'}`}>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* 모달 */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          onClick={() => { setIsModalOpen(false); setEditTarget(null); setSelectedResId(null); setIsManualPrice(false); setManualPrice(''); setRoomTouched(false); }}>
          <div className="bg-white w-full max-w-xl rounded-[2rem] p-6 md:p-8 relative overflow-y-auto max-h-[92vh] shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <button onClick={() => { setIsModalOpen(false); setEditTarget(null); setSelectedResId(null); setIsManualPrice(false); setManualPrice(''); setRoomTouched(false); }}
              className="absolute top-5 right-5 p-2 bg-slate-100 text-slate-500 rounded-full hover:bg-rose-500 hover:text-white transition-all">
              <X size={18} />
            </button>

            {/* 날짜 헤더 + 합계금액 */}
            <div className="mb-5">
              <h3 className="text-2xl font-black text-slate-900">{formData.date}</h3>
              <p className="text-blue-600 font-bold text-[10px] tracking-widest mt-0.5 uppercase">Daily Reservation View</p>
              {/* 합계 / 개별 금액 표시 - 해당 날짜 1박 요금 기준 */}
              {(reservationMap[formData.date]||[]).length > 0 && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {selectedResId ? (
                    (() => {
                      const sel = (reservationMap[formData.date]||[]).find(r => r.id === selectedResId);
                      if (!sel) return null;
                      // 해당 날짜가 sel의 몇 번째 박인지 계산 → 해당 날짜 1박 요금
                      const nightIdx = Math.round((new Date(formData.date+'T00:00:00') - new Date(sel.date+'T00:00:00')) / 86400000);
                      const dayPrice = getPricePerNight(sel.room, formData.date);
                      return (
                        <span className="px-3 py-1.5 bg-blue-600 text-white rounded-full text-xs font-black">
                          {sel.name}님 · ₩{dayPrice.toLocaleString()} ({nightIdx+1}박째)
                        </span>
                      );
                    })()
                  ) : (
                    <span className="px-3 py-1.5 bg-slate-900 text-white rounded-full text-xs font-black">
                      합계 · ₩{(reservationMap[formData.date]||[]).reduce((s,r) => s + getPricePerNight(r.room, formData.date), 0).toLocaleString()}
                    </span>
                  )}
                  {selectedResId && (
                    <button onClick={() => { setSelectedResId(null); setEditTarget(null); }}
                      className="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-full text-xs font-bold hover:bg-slate-200 transition-all">
                      전체보기
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* 예약 내역 목록 */}
            <div className="mb-6 space-y-2.5">
              {(reservationMap[formData.date]||[]).length > 0 ? (
                reservationMap[formData.date].map((r,i) => {
                  const isSelected = selectedResId === r.id;
                  return (
                    <div key={`${r.id}-${i}`}
                      onClick={() => {
                        if (selectedResId === r.id) {
                          // 선택 해제 → 폼 초기화
                          setSelectedResId(null);
                          setEditTarget(null);
                          setFormData({ date:formData.date, room:'Shell', name:'', phone:'010',
                            adults:0, kids:0, bbq:false, nights:1, memo:'', path:'직접' });
                          setIsManualPrice(false);
                          setManualPrice('');
                          setRoomTouched(false);
                        } else {
                          // 선택 → 폼에 내용 채우기 (수정 대기 상태)
                          setSelectedResId(r.id);
                          setEditTarget(r.id);
                          setFormData({ date:r.date, room:r.room, name:r.name, phone:r.phone||'010',
                            adults:r.adults||0, kids:r.kids||0, bbq:r.bbq||false,
                            nights:r.nights||1, memo:r.memo||'', path:r.path||'직접' });
                          setIsManualPrice(false);
                          setManualPrice('');
                          setRoomTouched(true); // 기존 예약 = 이미 방 선택됨
                        }
                      }}
                      className={`p-4 rounded-2xl border cursor-pointer transition-all shadow-sm
                        ${isSelected ? 'ring-2 ring-blue-500 shadow-md' : 'hover:shadow-md'}
                        ${ROOMS.find(rm=>rm.id===r.room)?.color||'bg-slate-50'}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-black text-base">{r.room}</span>
                            <span className="font-bold text-sm text-slate-600">{r.name}님</span>
                            <span className="font-black text-sm text-slate-800">
                              ₩{getPricePerNight(r.room, formData.date).toLocaleString()}
                            </span>
                          </div>
                          <div className="text-[10px] font-bold mt-1.5 opacity-70 flex items-center gap-2 flex-wrap">
                            {r.phone && (
                              <a href={`tel:${r.phone}`}
                                onClick={e => e.stopPropagation()}
                                className="text-blue-600 underline flex items-center gap-1">
                                <Phone size={10}/>{formatPhone(r.phone)}
                              </a>
                            )}
                            <span>{r.nights}박</span>
                            {r.adults > 0 && <span>성인 {r.adults}</span>}
                            {r.kids > 0 && <span>아동 {r.kids}</span>}
                            {r.path && <span className="bg-white/60 px-2 py-0.5 rounded-full">{r.path}</span>}
                          </div>
                        </div>
                        {/* 삭제 - 선택됐을 때만 표시 */}
                        {isSelected && (
                          <div className="flex gap-2 ml-2 shrink-0" onClick={e => e.stopPropagation()}>
                            <button onClick={() => handleDelete(r.id)}
                              className="text-rose-500 p-2 bg-white/70 rounded-xl hover:bg-rose-500 hover:text-white transition-all">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-8 bg-slate-50 rounded-2xl text-center font-bold text-slate-400 border-2 border-dashed text-xs">
                  등록된 예약 내역이 없습니다.
                </div>
              )}
            </div>

            {/* 신규/수정 폼 */}
            <div className="pt-6 border-t-2 border-slate-100">
              <h4 className="font-black text-md mb-5 text-blue-600 flex items-center gap-2">
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
