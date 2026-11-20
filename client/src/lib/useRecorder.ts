import { useCallback, useEffect, useRef, useState } from "react";

export type RecState = "idle" | "starting" | "recording" | "paused" | "stopped";
export type PauseReason = "manual" | "inactivity" | null;

const INACTIVITY_MS = 5 * 60 * 1000;

type SR = any;
function getSpeechRecognition(): (new () => SR) | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function speechSupported() {
  return !!getSpeechRecognition();
}

/**
 * Enregistrement audio + transcription en direct.
 * - Une seule capture micro (getUserMedia) pour l'audio.
 * - La reconnaissance vocale du navigateur est relancée automatiquement quand elle se coupe
 *   (fin de phrase, silence), avec une limite pour éviter les boucles.
 * - Pause automatique après 5 minutes sans activité sonore.
 */
export function useRecorder(opts: { lang?: string; onFinal?: (text: string) => void } = {}) {
  const [state, setState] = useState<RecState>("idle");
  const [pauseReason, setPauseReason] = useState<PauseReason>(null);
  const [elapsed, setElapsed] = useState(0);
  const [interim, setInterim] = useState("");
  const [level, setLevel] = useState(0);
  const [speechStatus, setSpeechStatus] = useState<"off" | "listening" | "unsupported" | "error">(
    speechSupported() ? "off" : "unsupported",
  );
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [silenceLeft, setSilenceLeft] = useState(INACTIVITY_MS);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recogRef = useRef<SR | null>(null);
  const wantSpeechRef = useRef(false);
  const restartTimesRef = useRef<number[]>([]);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const tickRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastActivityRef = useRef(Date.now());
  const elapsedRef = useRef(0);
  const lastTickRef = useRef(Date.now());
  const stateRef = useRef<RecState>("idle");
  const thresholdRef = useRef(0.02);
  const onFinalRef = useRef(opts.onFinal);
  onFinalRef.current = opts.onFinal;

  const setS = (s: RecState) => {
    stateRef.current = s;
    setState(s);
  };

  // ----- Reconnaissance vocale -----
  const startSpeech = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setSpeechStatus("unsupported");
      return;
    }
    wantSpeechRef.current = true;
    if (recogRef.current) {
      try {
        recogRef.current.start();
      } catch {
        /* déjà démarrée */
      }
      return;
    }
    const r: SR = new Ctor();
    r.lang = opts.lang || "fr-FR";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onstart = () => {
      setSpeechStatus("listening");
      setSpeechError(null);
    };
    r.onresult = (ev: any) => {
      let inter = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const t = res[0].transcript;
        if (res.isFinal) {
          const clean = t.trim();
          if (clean) onFinalRef.current?.(clean);
        } else inter += t;
      }
      setInterim(inter);
      lastActivityRef.current = Date.now();
    };
    r.onerror = (ev: any) => {
      const code = ev.error;
      if (code === "no-speech" || code === "aborted") return;
      if (code === "not-allowed" || code === "service-not-allowed") {
        wantSpeechRef.current = false;
        setSpeechStatus("error");
        setSpeechError("La transcription en direct est bloquée par le navigateur. L'audio continue d'être enregistré ; tu pourras compléter le texte ensuite.");
        return;
      }
      if (code === "network") {
        setSpeechError("Le service de transcription du navigateur ne répond pas (connexion). L'audio continue d'être enregistré, nouvel essai automatique…");
        return;
      }
      if (code === "audio-capture") {
        setSpeechError("Aucun micro disponible pour la transcription.");
        return;
      }
      setSpeechError(`Transcription interrompue (${code}). Nouvel essai automatique…`);
    };
    r.onend = () => {
      setInterim("");
      if (!wantSpeechRef.current || stateRef.current !== "recording") {
        setSpeechStatus((s) => (s === "error" || s === "unsupported" ? s : "off"));
        return;
      }
      // Relance contrôlée : max 6 relances en 20 s, sinon on espace.
      const now = Date.now();
      restartTimesRef.current = restartTimesRef.current.filter((t) => now - t < 20000);
      restartTimesRef.current.push(now);
      const delay = restartTimesRef.current.length > 6 ? 5000 : 250;
      window.setTimeout(() => {
        if (!wantSpeechRef.current || stateRef.current !== "recording") return;
        try {
          r.start();
        } catch {
          /* ignore */
        }
      }, delay);
    };
    recogRef.current = r;
    try {
      r.start();
    } catch {
      /* ignore */
    }
  }, [opts.lang]);

  const stopSpeech = useCallback((abort = false) => {
    wantSpeechRef.current = false;
    const r = recogRef.current;
    if (r) {
      try {
        abort ? r.abort() : r.stop();
      } catch {
        /* ignore */
      }
    }
    setInterim("");
  }, []);

  // ----- Boucles (niveau sonore + chrono + inactivité) -----
  const loop = useCallback(() => {
    const an = analyserRef.current;
    if (an) {
      const buf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      setLevel(Math.min(1, rms * 6));
      if (stateRef.current === "recording" && rms > thresholdRef.current) lastActivityRef.current = Date.now();
    }
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const pause = useCallback(
    (reason: PauseReason = "manual") => {
      if (stateRef.current !== "recording") return;
      const rec = recorderRef.current;
      if (rec && rec.state === "recording") rec.pause();
      streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = false));
      stopSpeech();
      setPauseReason(reason);
      setS("paused");
    },
    [stopSpeech],
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      if (stateRef.current === "recording") {
        elapsedRef.current += (now - lastTickRef.current) / 1000;
        setElapsed(Math.floor(elapsedRef.current));
        const left = INACTIVITY_MS - (now - lastActivityRef.current);
        setSilenceLeft(Math.max(0, left));
        if (left <= 0) pause("inactivity");
      }
      lastTickRef.current = now;
    }, 500);
    tickRef.current = id;
    return () => window.clearInterval(id);
  }, [pause]);

  const start = useCallback(async () => {
    if (stateRef.current === "recording" || stateRef.current === "starting") return;
    setMicError(null);
    setSpeechError(null);
    setS("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = () => {
        setAudioBlob(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
      };
      rec.start(1000);
      recorderRef.current = rec;

      const AC = window.AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new AC();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      ctxRef.current = ctx;
      analyserRef.current = an;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(loop);

      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        setMicError("Le micro a été déconnecté. L'enregistrement a été arrêté, l'audio capturé est conservé.");
        stopRef.current?.();
      });

      elapsedRef.current = 0;
      setElapsed(0);
      lastTickRef.current = Date.now();
      lastActivityRef.current = Date.now();
      setAudioBlob(null);
      setPauseReason(null);
      setS("recording");
      startSpeech();
    } catch (e: any) {
      setS("idle");
      if (e?.name === "NotAllowedError")
        setMicError("Accès au micro refusé. Clique sur l'icône de cadenas dans la barre d'adresse, autorise le micro, puis réessaie.");
      else if (e?.name === "NotFoundError") setMicError("Aucun micro détecté sur cet appareil.");
      else setMicError("Impossible de démarrer le micro : " + (e?.message || "erreur inconnue"));
    }
  }, [loop, startSpeech]);

  const resume = useCallback(() => {
    if (stateRef.current !== "paused") return;
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = true));
    const rec = recorderRef.current;
    if (rec && rec.state === "paused") rec.resume();
    lastActivityRef.current = Date.now();
    lastTickRef.current = Date.now();
    restartTimesRef.current = [];
    setPauseReason(null);
    setS("recording");
    startSpeech();
  }, [startSpeech]);

  const stop = useCallback(() => {
    if (stateRef.current === "idle" || stateRef.current === "stopped") return;
    stopSpeech(true);
    recogRef.current = null;
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    analyserRef.current = null;
    setLevel(0);
    setSpeechStatus((s) => (s === "unsupported" ? s : "off"));
    setPauseReason(null);
    setS("stopped");
  }, [stopSpeech]);
  const stopRef = useRef(stop);
  stopRef.current = stop;

  const reset = useCallback(() => {
    setAudioBlob(null);
    setElapsed(0);
    elapsedRef.current = 0;
    setS("idle");
  }, []);

  useEffect(
    () => () => {
      // Libère le micro si on quitte la page.
      wantSpeechRef.current = false;
      try {
        recogRef.current?.abort();
      } catch {
        /* ignore */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ctxRef.current?.close().catch(() => {});
    },
    [],
  );

  return {
    state,
    pauseReason,
    elapsed,
    interim,
    level,
    speechStatus,
    speechError,
    micError,
    audioBlob,
    silenceLeft,
    setThreshold: (v: number) => (thresholdRef.current = v),
    start,
    pause: () => pause("manual"),
    resume,
    stop,
    reset,
  };
}

export function formatDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
