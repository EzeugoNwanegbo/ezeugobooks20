import { useEffect, useRef, useState } from "react";
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type VoiceWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

export function useClerkingVoice() {
  const [supported, setSupported] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const epoch = useRef(0);
  useEffect(() => {
    const lifecycle = epoch;
    const engine = recognition;
    const w = window as VoiceWindow;
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    setCanSpeak("speechSynthesis" in window);
    return () => {
      lifecycle.current++;
      engine.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, []);
  const stop = () => {
    epoch.current++;
    recognition.current?.abort();
    recognition.current = null;
    setListening(false);
  };
  const hush = () => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  };
  const hear = (text: string) => {
    stop();
    hush();
    setError("");
    if (!("speechSynthesis" in window)) {
      setError("Spoken questions are unavailable in this browser. Read the question below.");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-NG";
    utterance.rate = 0.95;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => {
      setSpeaking(false);
      setError("The question could not be read aloud. You can read it below.");
    };
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };
  const start = (base: string, onText: (value: string) => void, language: string) => {
    stop();
    hush();
    setError("");
    const w = window as VoiceWindow,
      Constructor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Constructor) {
      setError("Voice input is unavailable here. Try Chrome or Edge, or type your answer.");
      return;
    }
    const current = epoch.current,
      r = new Constructor();
    recognition.current = r;
    r.continuous = true;
    r.interimResults = true;
    r.lang = language;
    r.onresult = (e) => {
      if (epoch.current !== current) return;
      const words = Array.from(e.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ");
      onText([base.trim(), words.trim()].filter(Boolean).join(" "));
    };
    r.onerror = (e) => {
      if (epoch.current !== current) return;
      setListening(false);
      setError(
        e.error === "not-allowed"
          ? "Microphone permission was denied. Allow it in browser settings, or type your answer."
          : "Voice input stopped. Your captured words are still below; check them and try again.",
      );
    };
    r.onend = () => {
      if (epoch.current === current) setListening(false);
    };
    try {
      r.start();
      setListening(true);
    } catch {
      setListening(false);
      setError("The microphone could not start. Try again or type your answer.");
    }
  };
  return { supported, canSpeak, listening, speaking, error, start, stop, hear, hush };
}
