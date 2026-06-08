import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mic, MicOff, Settings, X } from "lucide-react";
import { chatWithCora } from "@/lib/cora.functions";
import coraLogo from "@/assets/cora-logo.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Cora — AI Voice Assistant" },
      { name: "description", content: "Cora, your AI assistant powered by CoreAI. Talk to her in real time." },
      { property: "og:title", content: "Cora — AI Voice Assistant" },
      { property: "og:description", content: "Cora, your AI assistant powered by CoreAI. Talk to her in real time." },
      { property: "og:image", content: coraLogo.url },
      { name: "twitter:image", content: coraLogo.url },
    ],
    links: [
      { rel: "icon", href: coraLogo.url, type: "image/png" },
      { rel: "apple-touch-icon", href: coraLogo.url },
    ],
  }),
  component: CoraPage,
  ssr: false,
});

type Msg = { role: "user" | "assistant"; content: string };

const LS_INTRO = "cora_intro_seen";
const LS_WAKE = "cora_wake_word";
const LS_WAKE_ON = "cora_wake_enabled";

function CoraPage() {
  const chat = useServerFn(chatWithCora);
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [status, setStatus] = useState("Tap Start Session to talk to Cora");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");

  const [showIntro, setShowIntro] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [micState, setMicState] = useState<"unknown" | "granted" | "denied" | "prompting">("unknown");

  const [wakeWord, setWakeWord] = useState("hey cora");
  const [wakeEnabled, setWakeEnabled] = useState(false);
  const [wakeActive, setWakeActive] = useState(false);

  const recogRef = useRef<any>(null);
  const wakeRecogRef = useRef<any>(null);
  const messagesRef = useRef<Msg[]>([]);
  const activeRef = useRef(false);
  const mutedRef = useRef(false);
  const wakeWordRef = useRef("hey cora");

  // Boot: load prefs + intro flag
  useEffect(() => {
    try {
      if (!localStorage.getItem(LS_INTRO)) setShowIntro(true);
      const w = localStorage.getItem(LS_WAKE);
      if (w) { setWakeWord(w); wakeWordRef.current = w.toLowerCase(); }
      if (localStorage.getItem(LS_WAKE_ON) === "1") setWakeEnabled(true);
    } catch {}
    // Probe mic permission if supported
    (async () => {
      try {
        const p = await (navigator as any).permissions?.query?.({ name: "microphone" });
        if (p?.state === "granted") setMicState("granted");
        else if (p?.state === "denied") setMicState("denied");
      } catch {}
    })();
  }, []);

  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { wakeWordRef.current = wakeWord.trim().toLowerCase(); }, [wakeWord]);

  const dismissIntro = () => {
    try { localStorage.setItem(LS_INTRO, "1"); } catch {}
    setShowIntro(false);
  };

  const requestMic = async (): Promise<boolean> => {
    setMicState("prompting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicState("granted");
      return true;
    } catch {
      setMicState("denied");
      setStatus("Microphone blocked. Enable it in your browser settings.");
      return false;
    }
  };

  const speak = (text: string) =>
    new Promise<void>((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth) return resolve();
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      u.pitch = 1.15;
      const voices = synth.getVoices();
      const v =
        voices.find((x) => /female|zira|samantha|google.*female/i.test(x.name)) ||
        voices.find((x) => x.lang?.startsWith("en")) ||
        voices[0];
      if (v) u.voice = v;
      u.onstart = () => setSpeaking(true);
      u.onend = () => { setSpeaking(false); resolve(); };
      u.onerror = () => { setSpeaking(false); resolve(); };
      synth.speak(u);
    });

  const startRecognition = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setStatus("Voice not supported in this browser. Try Chrome.");
      return;
    }
    const r = new SR();
    r.lang = "en-IN";
    r.continuous = false;
    r.interimResults = false;
    r.onstart = () => { setListening(true); setStatus("Listening…"); };
    r.onresult = async (e: any) => {
      const text = e.results[0][0].transcript;
      setTranscript(text);
      setListening(false);
      setStatus("Thinking…");
      messagesRef.current.push({ role: "user", content: text });
      try {
        const { reply: r2 } = await chat({ data: { messages: messagesRef.current } });
        messagesRef.current.push({ role: "assistant", content: r2 });
        setReply(r2);
        setStatus("Speaking…");
        if (!mutedRef.current) await speak(r2);
        if (activeRef.current) {
          setStatus("Listening…");
          startRecognition();
        }
      } catch (err: any) {
        setStatus(err?.message || "Something went wrong");
      }
    };
    r.onerror = (e: any) => {
      setListening(false);
      if (e.error === "no-speech" && activeRef.current) {
        startRecognition();
        return;
      }
      setStatus(`Mic error: ${e.error}`);
    };
    r.onend = () => setListening(false);
    recogRef.current = r;
    try { r.start(); } catch {}
  };

  const startSession = async () => {
    stopWakeListener();
    const ok = micState === "granted" ? true : await requestMic();
    if (!ok) return;
    setActive(true);
    activeRef.current = true;
    messagesRef.current = [];
    setTranscript("");
    setReply("");
    const greet = "Hi, I'm Cora — your AI assistant powered by CoreAI.";
    setReply(greet);
    setStatus("Speaking…");
    if (!mutedRef.current) await speak(greet);
    setStatus("Listening…");
    startRecognition();
  };

  const endSession = () => {
    setActive(false);
    activeRef.current = false;
    try { recogRef.current?.stop(); } catch {}
    window.speechSynthesis?.cancel();
    setListening(false);
    setSpeaking(false);
    setStatus("Session ended");
    if (wakeEnabled) startWakeListener();
  };

  // --- Wake word listener ---
  const startWakeListener = () => {
    if (activeRef.current) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    try { wakeRecogRef.current?.stop?.(); } catch {}
    const r = new SR();
    r.lang = "en-IN";
    r.continuous = true;
    r.interimResults = true;
    r.onstart = () => { setWakeActive(true); setStatus(`Say "${wakeWordRef.current}" to start`); };
    r.onresult = (e: any) => {
      const txt = Array.from(e.results)
        .map((res: any) => res[0]?.transcript || "")
        .join(" ")
        .toLowerCase();
      if (wakeWordRef.current && txt.includes(wakeWordRef.current)) {
        try { r.stop(); } catch {}
        startSession();
      }
    };
    r.onerror = () => {};
    r.onend = () => {
      setWakeActive(false);
      if (wakeEnabled && !activeRef.current) {
        try { r.start(); } catch {}
      }
    };
    wakeRecogRef.current = r;
    try { r.start(); } catch {}
  };

  const stopWakeListener = () => {
    setWakeActive(false);
    try { wakeRecogRef.current?.stop?.(); } catch {}
    wakeRecogRef.current = null;
  };

  const toggleWake = async (next: boolean) => {
    setWakeEnabled(next);
    try { localStorage.setItem(LS_WAKE_ON, next ? "1" : "0"); } catch {}
    if (next) {
      const ok = micState === "granted" ? true : await requestMic();
      if (ok && !activeRef.current) startWakeListener();
    } else {
      stopWakeListener();
    }
  };

  const saveWakeWord = (w: string) => {
    const v = w.trim() || "hey cora";
    setWakeWord(v);
    try { localStorage.setItem(LS_WAKE, v); } catch {}
    if (wakeEnabled && !activeRef.current) {
      stopWakeListener();
      setTimeout(startWakeListener, 100);
    }
  };

  useEffect(() => () => {
    activeRef.current = false;
    try { recogRef.current?.stop(); } catch {}
    try { wakeRecogRef.current?.stop?.(); } catch {}
    window.speechSynthesis?.cancel();
  }, []);

  return (
    <div className="cora-bg relative flex min-h-screen flex-col items-center justify-between overflow-hidden px-4 py-6 text-white">
      {/* top bar */}
      <div className="z-10 flex w-full max-w-5xl items-center justify-between">
        <div className="flex items-center gap-2">
          <img src={coraLogo.url} alt="Cora logo" className="h-8 w-8 rounded-full" />
          <span className="text-sm font-medium tracking-wide">Cora</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => toggleWake(!wakeEnabled)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
              wakeEnabled
                ? "bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-400/50"
                : "bg-white/5 text-white/60 hover:bg-white/10"
            }`}
            aria-label={wakeEnabled ? "Stop wake word listening" : "Start wake word listening"}
            title={`Wake word: "${wakeWord}"`}
          >
            <span className={`relative flex h-2 w-2`}>
              {wakeActive && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
              )}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${wakeActive ? "bg-cyan-400" : wakeEnabled ? "bg-cyan-500/60" : "bg-white/30"}`} />
            </span>
            {wakeEnabled ? (wakeActive ? "Listening for wake" : "Wake on") : "Wake off"}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white"
            aria-label="Settings"
          >
            <Settings size={18} />
          </button>
          <button
            onClick={() => setMuted((m) => !m)}
            className="rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white"
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
        </div>
      </div>

      {/* orb */}
      <div className="relative flex flex-1 items-center justify-center">
        <div className="cora-glow" />
        <div className="cora-ring r1" />
        <div className="cora-ring r2" />
        <div className="cora-ring r3" />
        <div className={`cora-orb ${listening ? "listening" : ""} ${speaking ? "speaking" : ""}`}>
          CORA
        </div>
        {listening && (
          <div className="absolute right-8 top-1/2 -translate-y-1/2 text-sm text-fuchsia-200/80">
            • Listening
          </div>
        )}
        {wakeActive && !active && (
          <div className="absolute left-8 top-1/2 -translate-y-1/2 text-xs text-cyan-200/80">
            • Wake on
          </div>
        )}
      </div>

      {/* transcript */}
      <div className="z-10 mb-6 min-h-[60px] w-full max-w-2xl text-center">
        {transcript && <p className="text-sm text-white/60">You: "{transcript}"</p>}
        {reply && <p className="mt-1 text-base text-white/90">{reply}</p>}
        {!transcript && !reply && <p className="text-sm text-white/50">{status}</p>}
        {micState === "denied" && (
          <p className="mt-2 text-xs text-rose-300/90">
            Microphone is blocked. Click the lock icon in the address bar to allow it.
          </p>
        )}
      </div>

      {/* button */}
      <div className="z-10 mb-2">
        {!active ? (
          <button
            onClick={startSession}
            className="rounded-full bg-gradient-to-r from-fuchsia-600 to-pink-600 px-8 py-3 text-sm font-medium shadow-lg shadow-fuchsia-900/40 transition hover:brightness-110"
          >
            🎙 Start Session
          </button>
        ) : (
          <button
            onClick={endSession}
            className="rounded-full bg-gradient-to-r from-rose-600 to-red-600 px-8 py-3 text-sm font-medium shadow-lg shadow-rose-900/40 transition hover:brightness-110"
          >
            ■ End Session
          </button>
        )}
      </div>
      <div className="z-10 mb-1 text-xs text-white/40">{status}</div>

      {/* Intro overlay (first-time only) */}
      {showIntro && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xl px-4">
          <button
            onClick={dismissIntro}
            className="absolute right-4 top-4 rounded-full p-2 text-white/60 hover:bg-white/10 hover:text-white"
            aria-label="Skip intro"
          >
            <X size={20} />
          </button>
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-gradient-to-b from-white/5 to-white/[0.02] p-8 text-center shadow-2xl">
            <img src={coraLogo.url} alt="Cora" className="mx-auto mb-5 h-24 w-24 drop-shadow-[0_0_30px_rgba(168,85,247,0.6)]" />
            <h1 className="text-2xl font-semibold tracking-tight">Meet Cora</h1>
            <p className="mt-1 text-sm text-white/60">Your AI assistant powered by CoreAI</p>
            <ul className="mt-6 space-y-2 text-left text-sm text-white/75">
              <li>🎙 Talk naturally — Cora listens and replies in your voice.</li>
              <li>🌐 Hindi, Hinglish & English supported.</li>
              <li>✨ Say a wake word to start hands-free (set it in Settings).</li>
            </ul>
            <div className="mt-7 flex items-center justify-center gap-3">
              <button
                onClick={dismissIntro}
                className="rounded-full px-5 py-2 text-sm text-white/70 hover:bg-white/10"
              >
                Skip
              </button>
              <button
                onClick={async () => { dismissIntro(); await requestMic(); }}
                className="rounded-full bg-gradient-to-r from-fuchsia-600 to-pink-600 px-6 py-2 text-sm font-medium shadow-lg shadow-fuchsia-900/40 hover:brightness-110"
              >
                Get Started
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings dialog */}
      {showSettings && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur px-4" onClick={() => setShowSettings(false)}>
          <div
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#160a1f] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">Settings</h2>
              <button onClick={() => setShowSettings(false)} className="rounded-full p-1 text-white/60 hover:bg-white/10 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <label className="block text-xs uppercase tracking-wide text-white/50">Wake word</label>
            <input
              value={wakeWord}
              onChange={(e) => setWakeWord(e.target.value)}
              onBlur={(e) => saveWakeWord(e.target.value)}
              placeholder="hey cora"
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-fuchsia-500/60"
            />
            <p className="mt-1 text-[11px] text-white/40">Speak this phrase to start a session hands-free.</p>

            <div className="mt-4 flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <div>
                <p className="text-sm">Wake word listening</p>
                <p className="text-[11px] text-white/40">Mic stays on in the background.</p>
              </div>
              <button
                onClick={() => toggleWake(!wakeEnabled)}
                className={`relative h-6 w-11 rounded-full transition ${wakeEnabled ? "bg-fuchsia-600" : "bg-white/15"}`}
                aria-label="Toggle wake word"
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${wakeEnabled ? "left-5" : "left-0.5"}`} />
              </button>
            </div>

            <div className="mt-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs">
              Mic permission:{" "}
              <span className={micState === "granted" ? "text-emerald-300" : micState === "denied" ? "text-rose-300" : "text-white/60"}>
                {micState}
              </span>
              {micState !== "granted" && (
                <button onClick={requestMic} className="ml-2 rounded-md bg-white/10 px-2 py-0.5 hover:bg-white/20">
                  Request
                </button>
              )}
            </div>

            <button
              onClick={() => { try { localStorage.removeItem(LS_INTRO); } catch {}; setShowSettings(false); setShowIntro(true); }}
              className="mt-4 w-full rounded-lg border border-white/10 bg-white/5 py-2 text-xs text-white/70 hover:bg-white/10"
            >
              Show intro again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
