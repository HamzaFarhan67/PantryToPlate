import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bookmark, Clock, Users, Flame, Layers, Plus, ChevronRight,
  LogOut, LogIn, Mail, Key, User, UserPlus, Sparkles, Database,
  RotateCw, X, ChefHat, ArrowRight, BookOpen, Terminal, GripVertical
} from 'lucide-react';

// --- Firebase SDK Imports ---
import { initializeApp } from 'firebase/app';
import {
  getAuth, signInAnonymously, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut
} from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

const initialPantryData = [
  { id: '1', name: 'Chicken Breast', category: 'Proteins' },
  { id: '2', name: 'Heavy Cream',    category: 'Dairy'    },
  { id: '3', name: 'Mushrooms',      category: 'Vegetables'},
  { id: '4', name: 'Garlic',         category: 'Staples'  }
];

const getSafeConfig = () => {
  if (typeof __firebase_config !== 'undefined') return JSON.parse(__firebase_config);
  try {
    return {
      apiKey:            import.meta.env.VITE_FIREBASE_API_KEY            || "",
      authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        || "",
      projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         || "",
      storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET     || "",
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID|| "",
      appId:             import.meta.env.VITE_FIREBASE_APP_ID             || ""
    };
  } catch { return { apiKey:"",authDomain:"",projectId:"",storageBucket:"",messagingSenderId:"",appId:"" }; }
};

const app   = initializeApp(getSafeConfig());
const auth  = getAuth(app);
const db    = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'pantry-to-plate-app';

// ─── drag-resize constants ────────────────────────────────────────────────────
const CHAT_MIN_PX  = 280;
const CHAT_MAX_PX  = 700;
const CHAT_DEFAULT = 360;

export default function App() {
  // ── state ──────────────────────────────────────────────────────────────────
  const [pantry,       setPantry]       = useState([]);
  const [newItem,      setNewItem]      = useState('');
  const [category,     setCategory]     = useState('Proteins');
  const [user,         setUser]         = useState(null);
  const [authLoading,  setAuthLoading]  = useState(true);
  const [dbStatus,     setDbStatus]     = useState("Connecting...");
  const [isSignUp,     setIsSignUp]     = useState(false);
  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [authError,    setAuthError]    = useState('');
  const [isSearching,  setIsSearching]  = useState(false);
  const [logs,         setLogs]         = useState([]);
  const [recipe,       setRecipe]       = useState(null);
  const [chatInput,    setChatInput]    = useState('');
  const [chatHistory,  setChatHistory]  = useState([
    { role: 'assistant', content: "Hello Chef! 🍳 I am your AI Sous-Chef. Tell me what dish you'd like to cook (e.g. 'Lasagna'), and I'll walk you through step-by-step!" }
  ]);
  const [isChatLoading, setIsChatLoading] = useState(false);

  // ── drag-resize state ──────────────────────────────────────────────────────
  const [chatWidth,   setChatWidth]   = useState(CHAT_DEFAULT); // px on desktop
  const [isResizing,  setIsResizing]  = useState(false);
  const dragStartX    = useRef(0);
  const dragStartW    = useRef(CHAT_DEFAULT);
  const containerRef  = useRef(null);

  // mobile: chat panel collapsed/expanded
  const [chatOpen, setChatOpen] = useState(false);

  const chatEndRef = useRef(null);

  // ── auto-scroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isChatLoading]);

  // ── auth listener ──────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      if (u) setDbStatus(u.isAnonymous ? "Logged in anonymously" : `Synced: ${u.email}`);
      else { setDbStatus("Not authenticated"); setPantry([]); setRecipe(null); setLogs([]); }
    });
    return () => unsub();
  }, []);

  // ── firestore listener ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const ref = doc(db, 'artifacts', appId, 'users', user.uid, 'inventory', 'pantry');
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        if (d?.items) { setPantry(d.items); setDbStatus(user.isAnonymous ? "Anonymous sync active" : `Synced: ${user.email}`); }
      } else {
        setDoc(ref, { items: initialPantryData }).catch(console.error);
      }
    }, (e) => { console.error(e); setDbStatus("Database disconnect."); });
    return () => unsub();
  }, [user]);

  const saveToCloud = async (items) => {
    if (!user) return;
    try { await setDoc(doc(db,'artifacts',appId,'users',user.uid,'inventory','pantry'), { items }); }
    catch (e) { console.error(e); }
  };

  // ── auth handlers ──────────────────────────────────────────────────────────
  const handleAuthSubmit = async (e) => {
    e.preventDefault(); setAuthError('');
    if (!email || !password) { setAuthError('Please fill in all fields.'); return; }
    try {
      if (isSignUp) await createUserWithEmailAndPassword(auth, email, password);
      else          await signInWithEmailAndPassword(auth, email, password);
      setEmail(''); setPassword('');
    } catch (err) {
      const m = { 'auth/email-already-in-use':'That email is already registered.',
                  'auth/weak-password':'Password must be at least 6 characters.',
                  'auth/invalid-credential':'Incorrect email or password.' };
      setAuthError(m[err.code] || err.message.replace('Firebase: ',''));
    }
  };

  const handleAnonymousDemo = async () => {
    try { setAuthError(''); await signInAnonymously(auth); }
    catch { setAuthError('Anonymous access failed.'); }
  };

  // ── inventory handlers ─────────────────────────────────────────────────────
  const handleAddIngredient = (e) => {
    e.preventDefault();
    if (!newItem.trim()) return;
    const item = { id: Date.now().toString(), name: newItem.trim(), category };
    const next = [...pantry, item];
    setPantry(next); saveToCloud(next); setNewItem('');
  };

  const handleRemoveItem = (id) => {
    const next = pantry.filter(i => i.id !== id);
    setPantry(next); saveToCloud(next);
  };

  // ── agent search ───────────────────────────────────────────────────────────
  const triggerAgentSearch = async () => {
    if (!pantry.length) return;
    setRecipe(null);
    setLogs(["Checking system database parameters...","Fetching cloud pantry state...","Formulating recipe schema structure..."]);
    setIsSearching(true);
    try {
      const res = await fetch('http://127.0.0.1:8000/api/match-recipe', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ingredients: pantry.map(i=>i.name) })
      });
      if (!res.ok) throw new Error('Network handshake failed');
      const data = await res.json();
      setLogs(p=>[...p,"Payload received!","Parsing instructions..."]);
      setRecipe(data);
      setChatHistory(p=>[...p,{ role:'assistant', content:`Matched! 🎉 I can help you cook **${data.title}**.` }]);
    } catch (err) {
      setLogs(p=>[...p,"CONNECTION ERROR: Check if FastAPI is running on port 8000."]);
    } finally { setIsSearching(false); }
  };

  // ── chat ───────────────────────────────────────────────────────────────────
  const handleSendChatMessage = async (custom = null) => {
    const text = custom || chatInput;
    if (!text.trim()) return;
    setChatHistory(p=>[...p,{ role:'user', content:text }]);
    setChatInput(''); setIsChatLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:8000/api/chat', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ message:text, history:chatHistory, pantry:pantry.map(i=>i.name), current_recipe:recipe })
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setChatHistory(p=>[...p,{ role:'assistant', content:d.response }]);
    } catch {
      setChatHistory(p=>[...p,{ role:'assistant', content:"Sorry, I couldn't reach the backend." }]);
    } finally { setIsChatLoading(false); }
  };

  // ── drag-resize logic ──────────────────────────────────────────────────────
  const onDragStart = useCallback((e) => {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartW.current = chatWidth;
    setIsResizing(true);
  }, [chatWidth]);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e) => {
      const delta = dragStartX.current - e.clientX;          // drag left = expand chat
      const next  = Math.min(CHAT_MAX_PX, Math.max(CHAT_MIN_PX, dragStartW.current + delta));
      setChatWidth(next);
    };
    const onUp = () => setIsResizing(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [isResizing]);

  // ── loading screen ─────────────────────────────────────────────────────────
  if (authLoading) return (
    <div className="min-h-screen bg-[#fbf9f8] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
        <RotateCw className="w-8 h-8 text-[#ffd700] animate-spin" />
        <p className="text-sm text-slate-500 font-semibold">Syncing connection with Cloud...</p>
      </div>
    </div>
  );

  const categories        = ['Proteins','Dairy','Vegetables','Grains','Staples'];
  const getCategorized    = (cat) => pantry.filter(i => i.category === cat);

  return (
    <div className="min-h-screen bg-[#fbf9f8] font-sans text-slate-800 flex flex-col">

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-slate-100 shadow-sm px-4 sm:px-8 py-4 flex flex-wrap gap-3 items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#ffd700] rounded-xl shadow-sm">
            <ChefHat className="w-5 h-5 sm:w-6 sm:h-6 text-slate-900" />
          </div>
          <div>
            <h1 className="text-base sm:text-xl font-extrabold tracking-tight text-slate-900">PantryToPlate</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest hidden sm:block">Multi-user Real-time Dashboard</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {user && (
            <>
              <div className="text-[10px] font-bold uppercase tracking-widest bg-slate-50 border border-slate-100 px-3 py-2 rounded-2xl text-slate-500 flex items-center gap-2">
                <Database className="w-3.5 h-3.5 text-[#ffd700]" />
                <span className="hidden md:inline">Cloud: </span>
                <span className="text-emerald-600 font-extrabold truncate max-w-[140px]">{dbStatus}</span>
              </div>
              {/* mobile chat toggle */}
              <button
                onClick={() => setChatOpen(o => !o)}
                className="lg:hidden text-xs font-bold bg-[#ffd700] text-slate-900 px-3 py-2 rounded-2xl flex items-center gap-1.5"
              >
                <Bookmark className="w-4 h-4" />
                {chatOpen ? 'Hide Chat' : 'Sous-Chef'}
              </button>
              <button
                onClick={() => signOut(auth)}
                className="text-xs cursor-pointer font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-rose-600 px-3 sm:px-4 py-2 sm:py-2.5 rounded-2xl flex items-center gap-1.5 transition-all"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </>
          )}
        </div>
      </header>

      {/* ── AUTH SCREEN ────────────────────────────────────────────────────── */}
      {!user ? (
        <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
          <div className="max-w-md w-full bg-white border border-slate-100 rounded-[32px] p-6 sm:p-8 flex flex-col gap-6 shadow-sm">
            <div className="text-center">
              <div className="inline-block bg-[#ffd700]/10 p-4 rounded-3xl border border-[#ffd700]/20 mb-3">
                <User className="w-8 h-8 text-slate-900" />
              </div>
              <h2 className="text-2xl font-black tracking-tight text-slate-900">
                {isSignUp ? 'Create Account' : 'Welcome Back'}
              </h2>
              <p className="text-xs text-slate-400 font-medium mt-1">
                {isSignUp ? 'Register to manage your persistent inventory.' : 'Log in to access your saved ingredients.'}
              </p>
            </div>

            {authError && (
              <div className="bg-rose-50 border border-rose-100 text-rose-600 text-xs px-4 py-3 rounded-2xl font-bold">{authError}</div>
            )}

            <form onSubmit={handleAuthSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 pl-1">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-3.5 w-4 h-4 text-slate-400" />
                  <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"
                    className="w-full bg-slate-50 border-none rounded-2xl pl-12 pr-4 py-3 text-sm focus:ring-2 focus:ring-[#ffd700] outline-none text-slate-800 font-medium" />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 pl-1">Password</label>
                <div className="relative">
                  <Key className="absolute left-4 top-3.5 w-4 h-4 text-slate-400" />
                  <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••"
                    className="w-full bg-slate-50 border-none rounded-2xl pl-12 pr-4 py-3 text-sm focus:ring-2 focus:ring-[#ffd700] outline-none text-slate-800 font-medium" />
                </div>
              </div>
              <button type="submit"
                className="w-full bg-[#ffd700] hover:bg-[#ffc800] text-slate-900 font-bold py-3.5 rounded-2xl text-sm flex items-center justify-center gap-2 shadow-md shadow-yellow-100 active:scale-[0.98] transition-all mt-2">
                {isSignUp ? <UserPlus className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
                {isSignUp ? 'Sign Up' : 'Sign In'}
              </button>
            </form>

            <div className="flex flex-col gap-3 text-center text-xs">
              <button onClick={()=>setIsSignUp(s=>!s)} className="text-slate-600 hover:text-slate-900 font-bold underline cursor-pointer">
                {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Create one"}
              </button>
              <div className="flex items-center gap-2 my-1 text-slate-300 font-bold text-[10px] uppercase">
                <div className="h-[1px] bg-slate-100 flex-1" /><span>OR</span><div className="h-[1px] bg-slate-100 flex-1" />
              </div>
              <button onClick={handleAnonymousDemo} className="text-slate-500 hover:text-slate-900 font-bold transition-all cursor-pointer">
                Continue anonymously for testing
              </button>
            </div>
          </div>
        </div>

      ) : (
        /* ── MAIN DASHBOARD ──────────────────────────────────────────────── */
        <div
          ref={containerRef}
          className="flex-1 flex flex-col lg:flex-row gap-4 p-4 sm:p-6 overflow-hidden"
          style={{ userSelect: isResizing ? 'none' : 'auto' }}
        >

          {/* ── LEFT: Pantry Map ─────────────────────────────────────────── */}
          <aside className="
            w-full lg:w-72 xl:w-80 shrink-0
            bg-white rounded-[32px] shadow-sm border border-slate-100
            flex flex-col overflow-hidden
            lg:h-[calc(100vh-6rem)]
          ">
            <div className="p-5 sm:p-8 border-b border-slate-50">
              <div className="flex items-center gap-3 mb-1">
                <div className="p-2 bg-[#ffd700] rounded-xl shadow-sm">
                  <Layers className="w-5 h-5 text-slate-900" />
                </div>
                <h2 className="text-xl sm:text-2xl font-black tracking-tight">Pantry Map</h2>
              </div>
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">{pantry.length} ingredients tracked</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
              {categories.map(cat => {
                const items = getCategorized(cat);
                if (!items.length) return null;
                return (
                  <section key={cat} className="space-y-2">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-2">{cat}</h3>
                    <div className="space-y-2">
                      {items.map(item => (
                        <div key={item.id}
                          className="py-2.5 px-4 rounded-2xl border border-slate-100 hover:border-slate-200 bg-white hover:shadow-sm transition-all flex items-center justify-between gap-3">
                          <span className="font-extrabold text-slate-900 text-sm truncate">{item.name}</span>
                          <button onClick={()=>handleRemoveItem(item.id)}
                            className="p-1.5 bg-slate-50 hover:bg-rose-50 rounded-xl text-slate-400 hover:text-rose-500 transition-all shrink-0">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
              {!pantry.length && (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <BookOpen className="w-10 h-10 text-slate-300 mb-2" />
                  <p className="text-sm font-bold text-slate-400">Your pantry is empty.</p>
                  <p className="text-xs text-slate-300 mt-1 max-w-[180px]">Add ingredients below to begin.</p>
                </div>
              )}
            </div>

            <div className="p-4 sm:p-6 border-t border-slate-50 space-y-3">
              <form onSubmit={handleAddIngredient} className="flex flex-col gap-2">
                <input type="text" value={newItem} onChange={e=>setNewItem(e.target.value)} placeholder="Ingredient name..."
                  className="w-full bg-slate-50 border-none rounded-2xl py-3 px-4 font-semibold text-xs focus:ring-2 focus:ring-[#ffd700] outline-none text-slate-800" />
                <div className="flex gap-2">
                  <select value={category} onChange={e=>setCategory(e.target.value)}
                    className="flex-1 bg-slate-50 border-none rounded-2xl py-2 px-3 font-bold text-xs outline-none text-slate-500 cursor-pointer">
                    {categories.map(c=><option key={c}>{c}</option>)}
                  </select>
                  <button type="submit"
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-2xl font-bold text-xs flex items-center gap-1 transition-all">
                    <Plus className="w-4 h-4" /> Add
                  </button>
                </div>
              </form>
              <button onClick={triggerAgentSearch} disabled={!pantry.length || isSearching}
                className="w-full py-3.5 bg-[#ffd700] hover:bg-[#ffc800] disabled:bg-slate-100 disabled:text-slate-400 active:scale-[0.98] transition-all rounded-2xl font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-yellow-200">
                {isSearching ? <RotateCw className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5 text-slate-900" />}
                {isSearching ? 'Querying...' : 'Find Matches with AI'}
              </button>
            </div>
          </aside>

          {/* ── MIDDLE: Recipe ───────────────────────────────────────────── */}
          <main className="flex-1 min-w-0 flex flex-col gap-4 lg:h-[calc(100vh-6rem)] overflow-y-auto">

            {/* Agent log */}
            {(isSearching || logs.length > 0) && (
              <div className="bg-slate-900 text-emerald-400 rounded-3xl p-5 border border-slate-800 font-mono text-xs flex flex-col gap-2 shrink-0">
                <div className="flex items-center justify-between text-slate-400 border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-[10px]">
                    <Terminal className="w-4 h-4 text-[#ffd700]" />
                    <span>Agent Operations Log</span>
                  </div>
                  {isSearching && <RotateCw className="w-3.5 h-3.5 animate-spin text-[#ffd700]" />}
                </div>
                <div className="flex flex-col gap-1 max-h-[90px] overflow-y-auto">
                  {logs.map((log,i) => (
                    <div key={i} className="flex gap-2 text-slate-300">
                      <span className="text-[#ffd700] select-none">&gt;</span><span>{log}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {!recipe && !isSearching && (
              <div className="bg-white rounded-[40px] shadow-sm border border-slate-100 flex-1 flex flex-col items-center justify-center p-8 sm:p-12 text-center">
                <div className="p-5 bg-yellow-50 rounded-[32px] border border-yellow-100 mb-4 animate-bounce">
                  <ChefHat className="w-10 h-10 sm:w-12 sm:h-12 text-[#ffd700]" />
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-slate-900">Your Culinary Sandbox</h2>
                <p className="text-sm text-slate-400 mt-2 max-w-md leading-relaxed">
                  Add ingredients to your pantry and trigger the Chef Agent, or ask the Sous-Chef chatbot anything!
                </p>
              </div>
            )}

            {/* Recipe card */}
            {recipe && !isSearching && (
              <div className="bg-white rounded-[40px] shadow-sm border border-slate-50 overflow-hidden flex flex-col flex-1">
                <div className="relative h-48 sm:h-64 lg:h-72 shrink-0">
                  <img src="https://images.unsplash.com/photo-1519676867240-f03562e64548?q=80&w=1200&auto=format&fit=crop"
                    alt={recipe.title} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-white via-white/10 to-transparent opacity-80" />
                  <div className="absolute top-4 left-4 flex gap-2 flex-wrap">
                    <span className="px-3 py-1 bg-[#ffd700] text-slate-900 rounded-full text-[10px] font-black uppercase tracking-wider shadow-md">
                      {recipe.source || "Agent Verified"}
                    </span>
                    <span className="px-3 py-1 bg-white text-slate-900 rounded-full text-[10px] font-black uppercase tracking-wider shadow-md">AI Masterclass</span>
                  </div>
                  <div className="absolute bottom-4 left-5 right-5">
                    <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-slate-900 drop-shadow-sm mb-3">{recipe.title}</h1>
                    <div className="flex flex-wrap gap-2">
                      <StatPill icon={<Clock className="w-4 h-4" />}  label={`Prep: ${recipe.prepTime}`} />
                      <StatPill icon={<Users className="w-4 h-4" />}  label={`Serves ${recipe.servings}`} />
                      <StatPill icon={<Flame className="w-4 h-4" />}  label={`Cook: ${recipe.cookTime || "15 mins"}`} />
                    </div>
                  </div>
                </div>
                <div className="p-5 sm:p-8 grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 overflow-y-auto flex-1">
                  <section>
                    <h3 className="text-lg font-black mb-4 flex items-center gap-3">Ingredients <div className="h-1 w-8 bg-[#ffd700] rounded-full" /></h3>
                    <ul className="space-y-3">{recipe.ingredients.map((ing,i)=><IngredientListItem key={i} label={ing}/>)}</ul>
                  </section>
                  <section>
                    <h3 className="text-lg font-black mb-4 flex items-center gap-3">Directions <div className="h-1 w-8 bg-[#ffd700] rounded-full" /></h3>
                    <div className="space-y-5">{recipe.steps.map((step,i)=><StepItem key={i} number={String(i+1).padStart(2,'0')} text={step} active={i===0}/>)}</div>
                  </section>
                </div>
              </div>
            )}
          </main>

          {/* ── DRAG HANDLE (desktop only) ───────────────────────────────── */}
          <div
            onMouseDown={onDragStart}
            title="Drag to resize chat"
            className="
              hidden lg:flex
              w-4 shrink-0 items-center justify-center
              cursor-col-resize group
              rounded-full
            "
          >
            <div className={`
              flex flex-col items-center justify-center gap-0.5
              w-4 h-12 rounded-full transition-all
              ${isResizing
                ? 'bg-[#ffd700] shadow-lg'
                : 'bg-slate-200 group-hover:bg-[#ffd700]'
              }
            `}>
              <GripVertical className="w-3 h-3 text-slate-600" />
            </div>
          </div>

          {/* ── RIGHT: Chat ──────────────────────────────────────────────── */}
          {/* Mobile: slide-in overlay toggled by header button */}
          {/* Desktop: fixed pixel width set by drag */}
          <aside
            style={{ width: typeof window !== 'undefined' && window.innerWidth >= 1024 ? chatWidth : undefined }}
            className={`
              bg-white rounded-[32px] shadow-sm border border-slate-100
              flex flex-col overflow-hidden
              lg:h-[calc(100vh-6rem)] shrink-0
              /* mobile */
              fixed lg:static inset-x-4 bottom-4 top-[72px]
              transition-transform duration-300 z-30
              ${chatOpen ? 'translate-y-0' : 'translate-y-[110%]'}
              lg:translate-y-0
            `}
          >
            {/* Chat header */}
            <div className="p-4 sm:p-6 border-b border-slate-50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-[#ffd700] rounded-2xl flex items-center justify-center shadow-sm">
                    <Bookmark className="w-5 h-5 sm:w-6 sm:h-6 text-slate-900" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-green-500 border-4 border-white rounded-full animate-pulse" />
                </div>
                <div>
                  <h2 className="font-extrabold text-slate-900 text-sm">Sous-Chef AI</h2>
                  <p className="text-[9px] font-black text-green-600 uppercase tracking-widest">Live</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={()=>setChatHistory([{role:'assistant',content:"Let's cook step-by-step! What would you like to make?"}])}
                  className="text-[10px] font-bold text-slate-400 hover:text-slate-900 uppercase tracking-wider underline cursor-pointer">
                  Reset
                </button>
                {/* mobile close */}
                <button onClick={()=>setChatOpen(false)} className="lg:hidden p-1.5 rounded-xl bg-slate-100 text-slate-500">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Quick actions */}
            <div className="bg-slate-50 px-3 py-2 border-b border-slate-100/50 flex flex-wrap gap-1.5 shrink-0">
              {recipe && (
                <button onClick={()=>handleSendChatMessage(`Explain step-by-step how to make ${recipe.title}`)}
                  className="text-[9px] font-extrabold bg-[#ffd700]/15 text-slate-800 border border-[#ffd700]/30 px-2 py-1 rounded-lg hover:bg-[#ffd700]/30 transition-all cursor-pointer">
                  Guide recipe 🍳
                </button>
              )}
              <button onClick={()=>handleSendChatMessage("Next step")}
                className="text-[9px] font-extrabold bg-slate-200 text-slate-700 px-2 py-1 rounded-lg hover:bg-slate-300 transition-all flex items-center gap-1 cursor-pointer">
                Next step <ArrowRight className="w-3 h-3" />
              </button>
              <button onClick={()=>handleSendChatMessage("Substitute suggestions")}
                className="text-[9px] font-extrabold bg-slate-100 text-slate-500 px-2 py-1 rounded-lg hover:bg-slate-200 transition-all cursor-pointer">
                Substitutes 🥦
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              {chatHistory.map((msg,i)=>(
                <ChatMessage key={i} sender={msg.role==='user'?'You':'Sous-Chef AI'} time="Just now" text={msg.content} isUser={msg.role==='user'} />
              ))}
              {isChatLoading && (
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 text-slate-500 rounded-2xl rounded-tl-none p-3 text-xs w-fit">
                  <RotateCw className="w-3.5 h-3.5 animate-spin text-[#ffd700]" />
                  <span>Chef is thinking...</span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 sm:p-6 border-t border-slate-50 shrink-0">
              <form onSubmit={(e)=>{e.preventDefault();handleSendChatMessage();}} className="relative flex items-center">
                <input type="text" value={chatInput} onChange={e=>setChatInput(e.target.value)}
                  placeholder="Ask Sous-Chef..."
                  className="w-full bg-slate-50 border-none rounded-2xl py-3.5 pl-5 pr-14 font-semibold text-xs focus:ring-2 focus:ring-[#ffd700] outline-none text-slate-800" />
                <button type="submit" disabled={isChatLoading}
                  className="absolute right-2 p-2.5 bg-[#ffd700] hover:bg-[#ffc800] rounded-xl shadow-md transition-all active:scale-95 cursor-pointer">
                  <ChevronRight className="w-5 h-5 text-slate-900" />
                </button>
              </form>
            </div>
          </aside>

        </div>
      )}
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

const StatPill = ({ icon, label }) => (
  <div className="flex items-center gap-2 bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-2xl shadow-sm border border-slate-100 font-extrabold text-[11px] text-slate-800">
    <div className="text-[#ffd700]">{icon}</div>{label}
  </div>
);

const IngredientListItem = ({ label }) => (
  <li className="flex items-center gap-3 group cursor-pointer">
    <div className="w-2 h-2 rounded-full bg-[#ffd700] group-hover:scale-125 transition-all shadow-[0_0_6px_#ffd700] shrink-0" />
    <span className="text-slate-800 font-bold text-sm leading-relaxed">{label}</span>
  </li>
);

const StepItem = ({ number, text, active = false }) => (
  <div className="flex gap-4">
    <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm transition-all ${
      active ? 'bg-[#ffd700] text-slate-900 shadow-md shadow-yellow-100 scale-105' : 'bg-slate-50 text-slate-300 border border-slate-100'
    }`}>{number}</div>
    <p className={`text-xs leading-relaxed font-bold flex-1 ${active ? 'text-slate-900' : 'text-slate-400'}`}>{text}</p>
  </div>
);

const ChatMessage = ({ sender, time, text, isUser = false }) => (
  <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1`}>
    <div className="flex items-center gap-2 px-1">
      <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">{sender}</span>
      <span className="text-[8px] font-bold text-slate-300">{time}</span>
    </div>
    <div className={`max-w-[85%] p-3 rounded-2xl text-xs font-bold leading-relaxed shadow-sm ${
      isUser ? 'bg-[#ffd700] text-slate-900 rounded-tr-none' : 'bg-slate-50 text-slate-700 rounded-tl-none border border-slate-100'
    }`}>
      <div className="whitespace-pre-line">{text}</div>
    </div>
  </div>
);