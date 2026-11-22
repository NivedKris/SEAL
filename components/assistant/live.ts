"use client";

import { GoogleGenAI, Modality, type FunctionDeclaration, type LiveServerMessage, type Session } from "@google/genai";
import { assistant, type Mode } from "./store";
import { contextNow, runScreenTool } from "./screen";

/**
 * One live voice session with Gemini Live: the microphone streams in, SEAL's voice streams out,
 * both are captioned, and tool calls are answered (look-ups run on the server, changes become
 * proposals on screen). The API key never reaches the browser: the server issues a one-use token.
 */
type Setup = { token: string; models: string[]; voice: string; systemInstruction: string; tools: FunctionDeclaration[] };
const PROPOSED = "Proposed (nothing changed yet). It is on screen as a card. Ask in a few words whether to go ahead; call confirm_change with this proposalId only if they clearly say yes.";
// The live model sometimes acts (opens a screen, looks something up) and then closes its turn
// without a word. When that happens it is asked once, quietly, to say what it did.
const NUDGE = "(The results of your last action are in. Now tell the person, in one or two short sentences, what you did or found.)";
const SCREEN = new Set(["navigate", "offer_navigation", "get_screen", "go_back", "confirm_change", "reject_change"]);
const IN_RATE = 16000;
const OUT_RATE = 24000;

let current: LiveVoice | null = null;
export const liveSession = () => current;

export async function startLive(mode: Exclude<Mode, "chat">) {
  await current?.stop();
  current = new LiveVoice(mode);
  await current.start();
}
export async function stopLive() {
  await current?.stop();
  current = null;
}
/** Stop SEAL mid-answer and listen. */
export function interruptLive() {
  current?.interrupt();
}
/** Send typed text into the open voice session. */
export function sendLiveText(text: string) {
  current?.text(text);
}

const b64 = {
  fromInt16(a: Int16Array) {
    const bytes = new Uint8Array(a.buffer);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  toInt16(s: string) {
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  },
};

class LiveVoice {
  private session: Session | null = null;
  private mic: MediaStream | null = null;
  private inCtx: AudioContext | null = null;
  private outCtx: AudioContext | null = null;
  private outAnalyser: AnalyserNode | null = null;
  private playAt = 0;
  private playing = new Set<AudioBufferSourceNode>();
  private raf = 0;
  private micLevel = 0;
  // The room's background level, learnt as we go (for the orb and "Hearing you" only: the audio itself
  // is always sent untouched; muting or cutting it was tested and made recognition worse).
  private noiseFloor = 0.006;
  private calibration: number[] = [];
  // Speech captured while the line is still opening is kept and sent the moment it opens.
  private pending: Int16Array[] = [];
  private endAfterFlush = false;
  private lastVoice = 0;
  // Turn-taking (Talk): once the person has finished, the mic pauses until SEAL has answered, so a
  // repeated question can't reach it (no double answers) and SEAL can't interrupt itself.
  private uploading = true;
  private voiceMs = 0;
  private waitingSince = 0;
  private modelBusy = false;
  private turnDone = false;
  private dropAudio = false;
  private userCaption = "";
  private botCaption = "";
  private stopped = false;
  private afterTool = false;
  private spokeSinceTool = false;
  private nudged = false;

  constructor(private mode: Exclude<Mode, "chat">) {}

  async start() {
    assistant.setLive({ status: "connecting", level: 0, error: undefined, startedAt: Date.now() });
    try {
      await this.openMic();
      const ctx = contextNow();
      let lastErr: unknown;
      // The newest live model first; the next one if it cannot open (each attempt gets a fresh token).
      for (let i = 0; i < 2 && !this.session; i++) {
        const setup = (await fetch("/api/assistant/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ context: ctx, mode: this.mode }) }).then((r) => r.json())) as Setup & { error?: string };
        if (setup.error) throw new Error(setup.error);
        const model = setup.models[Math.min(i, setup.models.length - 1)];
        try {
          this.session = await this.connect(setup, model);
        } catch (e) {
          lastErr = e;
        }
      }
      if (!this.session) throw lastErr ?? new Error("could not open a voice session");
      if (this.stopped) return void this.session.close();
      // anything said while connecting goes first
      for (const pcm of this.pending) this.session.sendRealtimeInput({ audio: { data: b64.fromInt16(pcm), mimeType: `audio/pcm;rate=${IN_RATE}` } });
      this.pending = [];
      if (this.endAfterFlush) {
        this.endAfterFlush = false;
        this.session.sendRealtimeInput({ audioStreamEnd: true });
      }
      if (this.uploading) assistant.setLive({ status: "listening" });
      this.tick();
    } catch (e) {
      assistant.setLive({ status: "error", error: friendly(e) });
      await this.stop(true);
    }
  }

  private connect(setup: Setup, model: string): Promise<Session> {
    const ai = new GoogleGenAI({ apiKey: setup.token, httpOptions: { apiVersion: "v1alpha" } });
    return new Promise<Session>((resolve, reject) => {
      let ready = false;
      let s: Session | null = null;
      const timeout = setTimeout(() => !ready && reject(new Error("the voice service did not answer")), 12000);
      ai.live
        .connect({
          model,
          config: {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: setup.voice } } },
            systemInstruction: setup.systemInstruction,
            tools: [{ functionDeclarations: setup.tools }],
          },
          callbacks: {
            onmessage: (m) => {
              if (m.setupComplete && !ready) {
                ready = true;
                clearTimeout(timeout);
                // the session object arrives just after setup completes
                const wait = () => (s ? resolve(s) : setTimeout(wait, 10));
                wait();
              }
              this.onMessage(m);
            },
            onerror: (e) => {
              if (!ready) reject(new Error((e as { message?: string }).message ?? "voice connection failed"));
            },
            onclose: (e) => {
              if (!ready) reject(new Error(e.reason || `voice connection closed (${e.code})`));
              else if (!this.stopped) {
                assistant.setLive({ status: "error", error: e.code === 1000 ? "The voice session ended." : `The voice session closed: ${e.reason || e.code}` });
                void this.stop(true);
              }
            },
          },
        })
        .then((x) => (s = x))
        .catch(reject);
    });
  }

  private async openMic() {
    this.mic = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.inCtx = new AudioContext();
    await this.inCtx.audioWorklet.addModule("/assistant/mic-worklet.js");
    const src = this.inCtx.createMediaStreamSource(this.mic);
    const node = new AudioWorkletNode(this.inCtx, "mic-capture");
    const ratio = this.inCtx.sampleRate / IN_RATE;
    node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
      const f = ev.data;
      let sum = 0;
      for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
      const rms = Math.sqrt(sum / f.length);
      const now = performance.now();
      // Learn the room first: the opening ~0.6 s set the background level; nothing counts as speech yet.
      if (this.calibration.length < 15) {
        this.calibration.push(rms);
        this.noiseFloor = Math.max(0.002, this.calibration.reduce((a, b) => a + b, 0) / this.calibration.length);
      }
      // Then the floor drops quickly to quiet moments and creeps up slowly to a steady hum (an air
      // conditioner, a fan), while short bursts like words barely move it.
      else this.noiseFloor = Math.max(0.002, rms < this.noiseFloor ? this.noiseFloor * 0.8 + rms * 0.2 : this.noiseFloor + (rms - this.noiseFloor) * 0.03);
      const calibrated = this.calibration.length >= 15;
      // Speech is clearly above the background; while SEAL is talking, demand more (its own voice
      // leaking into the mic would otherwise interrupt it).
      const threshold = Math.max(0.012, this.noiseFloor * 2.2) * (this.playing.size ? 2.4 : 1);
      const frameMs = (f.length / (this.inCtx?.sampleRate ?? 48000)) * 1000;
      if (calibrated && rms > threshold) {
        this.lastVoice = now;
        this.voiceMs += frameMs;
      } else if (now - this.lastVoice > 1000 && this.voiceMs < 500) this.voiceMs = 0; // a blip (a cough, a door), not speech
      this.micLevel = this.uploading && now - this.lastVoice < 300 ? Math.min(1, rms * 6) : 0;
      if (!this.uploading) return;
      // downsample to 16 kHz, 16-bit, and send as is
      const n = Math.floor(f.length / ratio);
      const out = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const v = f[Math.floor(i * ratio)];
        out[i] = Math.max(-1, Math.min(1, v)) * 0x7fff;
      }
      if (this.session) this.session.sendRealtimeInput({ audio: { data: b64.fromInt16(out), mimeType: `audio/pcm;rate=${IN_RATE}` } });
      else {
        this.pending.push(out);
        if (this.pending.length > 180) this.pending.shift(); // keep the last ~8 s
      }
      // Talk: after real speech and a second of quiet, the question is complete: hand the turn over.
      if (this.mode === "talk" && this.voiceMs >= 500 && now - this.lastVoice > 1000) this.handOver();
    };
    src.connect(node);
    this.outCtx = new AudioContext({ sampleRate: OUT_RATE });
    this.outAnalyser = this.outCtx.createAnalyser();
    this.outAnalyser.fftSize = 512;
    this.outAnalyser.connect(this.outCtx.destination);
  }

  /** The person has finished: tell Gemini the question is complete and pause the mic until it answers. */
  private handOver() {
    this.afterTool = this.spokeSinceTool = this.nudged = false;
    this.voiceMs = 0;
    this.uploading = false;
    this.modelBusy = false;
    this.turnDone = false;
    this.dropAudio = false;
    this.waitingSince = performance.now();
    if (this.session) this.session.sendRealtimeInput({ audioStreamEnd: true });
    else this.endAfterFlush = true; // finished before the line opened: end it right after the flush
    if (!assistant.get().messages.some((x) => x.id === "live-user")) assistant.stream("live-user", "user", "");
    assistant.setLive({ status: "thinking" });
  }

  /** SEAL has finished (or was interrupted): listen again. */
  private resume() {
    this.uploading = true;
    this.voiceMs = 0;
    this.lastVoice = 0;
    this.waitingSince = 0;
    this.modelBusy = false;
    this.turnDone = false;
    assistant.set((s) => ({ messages: s.messages.filter((x) => !(x.id === "live-user" && !x.text.trim())) }));
    if (!this.stopped) assistant.setLive({ status: "listening" });
  }

  /** Tap the orb while SEAL is talking: stop it and listen straight away. */
  interrupt() {
    if (this.mode !== "talk" || this.uploading) return;
    this.stopPlayback();
    this.dropAudio = true;
    this.closeCaption("live-bot");
    this.resume();
  }

  private onMessage(m: LiveServerMessage) {
    const sc = m.serverContent;
    if (m.toolCall || sc?.modelTurn || sc?.outputTranscription) {
      this.modelBusy = true;
      // Gemini may decide the question is over on its own: pause the mic all the same.
      if (this.mode === "talk" && this.uploading && !this.dropAudio) {
        this.uploading = false;
        this.voiceMs = 0;
        this.waitingSince = performance.now();
      }
    }
    if (sc?.interrupted) this.stopPlayback();
    if (sc?.outputTranscription?.text || sc?.modelTurn?.parts?.some((p) => p.inlineData?.data)) this.spokeSinceTool = true;
    for (const p of sc?.modelTurn?.parts ?? []) if (p.inlineData?.data && this.mode === "talk" && !this.dropAudio) this.play(p.inlineData.data);
    if (sc?.inputTranscription?.text) {
      this.userCaption += sc.inputTranscription.text;
      assistant.stream("live-user", "user", sc.inputTranscription.text);
      if (this.uploading && assistant.get().live.status !== "speaking") assistant.setLive({ status: "listening" });
    }
    if (sc?.outputTranscription?.text) {
      if (this.userCaption) this.closeCaption("live-user");
      this.botCaption += sc.outputTranscription.text;
      assistant.stream("live-bot", "assistant", sc.outputTranscription.text);
    }
    if (sc?.turnComplete && this.mode === "talk" && !this.dropAudio && this.afterTool && !this.spokeSinceTool && !this.nudged && this.session) {
      // acted but said nothing: ask it to say what it did, and keep waiting for that
      this.nudged = true;
      const s = this.session;
      setTimeout(() => s.sendRealtimeInput({ text: NUDGE }), 250);
      return;
    }
    if (sc?.turnComplete) {
      this.closeCaption("live-user");
      this.closeCaption("live-bot");
      if (this.dropAudio) this.dropAudio = false;
      else if (this.mode === "talk") {
        this.turnDone = true;
        if (!this.playing.size) this.resume(); // otherwise when the last of SEAL's voice has played
      }
    }
    if (m.toolCall?.functionCalls?.length) void this.onTools(m.toolCall.functionCalls);
  }

  /** Freeze a streaming caption into a normal message, so the next turn starts a new one. */
  private closeCaption(id: "live-user" | "live-bot") {
    const s = assistant.get();
    const msg = s.messages.find((x) => x.id === id);
    if (!msg) return;
    assistant.set({ messages: s.messages.map((x) => (x.id === id ? { ...x, id: `${id}-${Date.now()}`, live: false } : x)) });
    if (id === "live-user") this.userCaption = "";
    else this.botCaption = "";
  }

  private async onTools(calls: { id?: string; name?: string; args?: Record<string, unknown> }[]) {
    assistant.setLive({ status: "thinking" });
    const context = contextNow();
    const responses = await Promise.all(
      calls.map(async (fc) => {
        const name = fc.name ?? "";
        const args = fc.args ?? {};
        if (name === "show_details") {
          // the written answer appears in the panel while the summary is spoken
          if (typeof args.text === "string" && args.text.trim()) assistant.say({ role: "assistant", text: args.text, detail: true });
          return { id: fc.id, name, response: { status: "Shown on screen. Now say a short summary out loud." } };
        }
        if (WRITE.has(name)) {
          const p = assistant.propose(name, args);
          return { id: fc.id, name, response: { status: PROPOSED, proposalId: p.id } };
        }
        // Moving around SEAL, reading the screen, or a change they just said yes to: done in the browser.
        if (SCREEN.has(name)) return { id: fc.id, name, response: await runScreenTool(name, args).catch((e) => ({ error: String(e) })) };
        const r = await fetch("/api/assistant/tool", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, args, context }) })
          .then((x) => x.json())
          .catch((e) => ({ result: { error: String(e) } }));
        return { id: fc.id, name, response: { result: r.result ?? r } };
      }),
    );
    this.session?.sendToolResponse({ functionResponses: responses });
    this.afterTool = true;
    this.spokeSinceTool = false;
  }

  private play(data: string) {
    const ctx = this.outCtx;
    if (!ctx || !this.outAnalyser) return;
    const pcm = b64.toInt16(data);
    const buf = ctx.createBuffer(1, pcm.length, OUT_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.outAnalyser);
    this.playAt = Math.max(this.playAt, ctx.currentTime + 0.03);
    src.start(this.playAt);
    this.playAt += buf.duration;
    this.playing.add(src);
    src.onended = () => {
      this.playing.delete(src);
      if (this.playing.size) return;
      if (this.turnDone && !this.uploading) this.resume();
      else if (assistant.get().live.status === "speaking") assistant.setLive({ status: "thinking" });
    };
    assistant.setLive({ status: "speaking" });
  }

  private stopPlayback() {
    for (const s of this.playing) {
      try {
        s.stop();
      } catch {}
    }
    this.playing.clear();
    this.playAt = 0;
  }

  /** Orb level: the speaker's voice while listening, SEAL's voice while speaking. */
  private tick = () => {
    if (this.stopped) return;
    // Nothing came back: say so and listen again, instead of waiting silently.
    const now = performance.now();
    if (this.mode === "talk" && !this.uploading && this.waitingSince) {
      if (!this.modelBusy && now - this.waitingSince > 8000) {
        assistant.say({ role: "note", text: "I didn't catch that. Please say it again." });
        this.resume();
      } else if (this.modelBusy && !this.playing.size && now - this.waitingSince > 45000) this.resume();
    }
    let out = 0;
    if (this.outAnalyser && this.playing.size) {
      const a = new Uint8Array(this.outAnalyser.fftSize);
      this.outAnalyser.getByteTimeDomainData(a);
      let sum = 0;
      for (const v of a) sum += ((v - 128) / 128) ** 2;
      out = Math.min(1, Math.sqrt(sum / a.length) * 4);
    }
    assistant.setLive({ level: Math.max(out, this.micLevel) });
    this.raf = requestAnimationFrame(this.tick);
  };

  text(t: string) {
    this.afterTool = this.spokeSinceTool = this.nudged = false;
    assistant.say({ role: "user", text: t });
    if (this.mode === "talk") {
      this.uploading = false;
      this.modelBusy = false;
      this.turnDone = false;
      this.waitingSince = performance.now();
      assistant.setLive({ status: "thinking" });
    }
    this.session?.sendRealtimeInput({ text: t });
  }

  async stop(keepError = false) {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.stopPlayback();
    try {
      this.session?.close();
    } catch {}
    this.session = null;
    this.mic?.getTracks().forEach((t) => t.stop());
    await this.inCtx?.close().catch(() => {});
    await this.outCtx?.close().catch(() => {});
    this.closeCaption("live-user");
    this.closeCaption("live-bot");
    if (!keepError) assistant.setLive({ status: "off", level: 0, error: undefined });
    else assistant.setLive({ level: 0 });
  }
}

const WRITE = new Set(["update_note", "add_diagnosis", "add_order", "remove_order", "request_prior_approval", "apply_recovery_fix", "draft_recovery_letter", "resubmit_claim", "answer_question", "apply_claim_fix", "send_claim", "send_ready_claims", "recheck_claim"]);

function friendly(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  if (/Permission|NotAllowed/i.test(m)) return "Microphone access was blocked. Allow the microphone for this site and try again.";
  if (/NotFound|Requested device/i.test(m)) return "No microphone was found.";
  return m.slice(0, 160);
}
