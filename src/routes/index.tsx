import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mic, MicOff } from "lucide-react";
import { chatWithCora } from "@/lib/cora.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Cora — AI Voice Assistant" },
      { name: "description", content: "Cora, your friendly AI voice assistant. Talk to her in real time." },
      { property: "og:title", content: "Cora — AI Voice Assistant" },
      { property: "og:description", content: "Cora, your friendly AI voice assistant. Talk to her in real time." },
    ],
  }),
  component: CoraPage,
  ssr: false,
});

type Msg = { role: "user" | "assistant"; content: string };

function CoraPage() {
  const chat = useServerFn(chatWithCora);
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [status, setStatus] = useState("Tap Start Session to talk to Cora");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");

  const recogRef = useRef<any>(null);
  const messagesRef = useRef<Msg[]>([]);
  const activeRef = useRef(false);
  const mutedRef = useRef(false);

  useEffect(() => { mutedRef.current = muted; }, [muted]);

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
  };

  useEffect(() => () => {
    activeRef.current = false;
    try { recogRef.current?.stop(); } catch {}
    window.speechSynthesis?.cancel();
  }, []);

  return (
    <div className="cora-bg relative flex min-h-screen flex-col items-center justify-between overflow-hidden px-4 py-6 text-white">
      {/* top bar */}
      <div className="z-10 flex w-full max-w-5xl items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-purple-700 text-xs font-semibold">Z</div>
          <span className="text-sm font-medium">Cora</span>
        </div>
        <button
          onClick={() => setMuted((m) => !m)}
          className="rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white"
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
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
      </div>

      {/* transcript */}
      <div className="z-10 mb-6 min-h-[60px] w-full max-w-2xl text-center">
        {transcript && (
          <p className="text-sm text-white/60">You: "{transcript}"</p>
        )}
        {reply && (
          <p className="mt-1 text-base text-white/90">{reply}</p>
        )}
        {!transcript && !reply && (
          <p className="text-sm text-white/50">{status}</p>
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
    </div>
  );
}
