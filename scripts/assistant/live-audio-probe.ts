/**
 * End-to-end voice test without a person: one live session speaks each test sentence (recorded at
 * 24 kHz), then that recording is streamed into SEAL's own voice session exactly as the browser
 * microphone would (16 kHz chunks in real time, a second of quiet, then end of speech). Prints what
 * SEAL heard, what it did, what it said, and whether its turn ended.
 *   MODEL=gemini-3.8-live npx tsx scripts/assistant/live-audio-probe.ts basic "sentence" …
 */
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { pathFor, type Destination } from "../../lib/assistant/sitemap";

const BASE = process.env.SEAL_URL ?? "http://localhost:3000";
const tenant = process.argv[2] ?? "basic";
const sentences = process.argv.slice(3);
const headers = { "content-type": "application/json", cookie: `seal-tenant=${tenant}` };
const post = (url: string, body: unknown) => fetch(BASE + url, { method: "POST", headers, body: JSON.stringify(body) }).then((r) => r.json());
const NUDGE = "(The results of your last action are in. Now tell the person, in one or two short sentences, what you did or found.)";

type Setup = { token: string; models: string[]; voice: string; systemInstruction: string; tools: unknown[] };
const open = (setup: Setup, model: string, system: string, tools: unknown[], on: (m: LiveServerMessage, s: Session) => void) =>
  new Promise<Session>((resolve, reject) => {
    const ai = new GoogleGenAI({ apiKey: setup.token, httpOptions: { apiVersion: "v1alpha" } });
    let s: Session | null = null;
    ai.live
      .connect({
        model,
        config: { responseModalities: [Modality.AUDIO], inputAudioTranscription: {}, outputAudioTranscription: {}, speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: setup.voice } } }, systemInstruction: system, ...(tools.length ? { tools: [{ functionDeclarations: tools as never }] } : {}) },
        callbacks: {
          onmessage: (m) => {
            if (m.setupComplete) {
              const w = () => (s ? resolve(s) : setTimeout(w, 10));
              w();
            }
            if (s) on(m, s);
          },
          onerror: (e) => reject(new Error(String((e as { message?: string }).message ?? e))),
        },
      })
      .then((x) => (s = x))
      .catch(reject);
  });

/** Have a live voice say the sentence; return 16 kHz PCM. */
async function speak(sentence: string): Promise<Int16Array> {
  const setup = (await post("/api/assistant/token", { context: { path: "/today" }, mode: "talk" })) as Setup;
  const chunks: Int16Array[] = [];
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, 20000);
    open(setup, "gemini-2.5-flash-native-audio-preview-09-2025", "You are a voice actor. Say the user's text out loud exactly, word for word, as a person asking a question in a clinic. Say nothing else.", [], (m) => {
      for (const p of m.serverContent?.modelTurn?.parts ?? []) if (p.inlineData?.data) {
        const b = Buffer.from(p.inlineData.data, "base64");
        chunks.push(new Int16Array(b.buffer, b.byteOffset, b.length >> 1));
      }
      if (m.serverContent?.turnComplete) {
        clearTimeout(t);
        resolve();
      }
    })
      .then((s) => s.sendRealtimeInput({ text: sentence }))
      .catch(reject);
  });
  // 24 kHz → 16 kHz
  const all = new Int16Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) all.set(c, (o += c.length) - c.length);
  const out = new Int16Array(Math.floor(all.length / 1.5));
  for (let i = 0; i < out.length; i++) out[i] = all[Math.floor(i * 1.5)];
  return out;
}

async function run(sentence: string, model: string, ctx: Record<string, unknown>) {
  const pcm = await speak(sentence);
  // NOISE=1: a room's hiss and air-conditioner hum under the speech and through the quiet after it
  const noisy = Number(process.env.NOISE ?? 0);
  const roomy = (i: number) => (noisy ? (Math.random() - 0.5) * 1400 * noisy + Math.sin((i / 16000) * 2 * Math.PI * 100) * 900 * noisy : 0);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, pcm[i] + roomy(i)));
  const setup = (await post("/api/assistant/token", { context: ctx, mode: "talk" })) as Setup;
  const log: string[] = [];
  let heard = "";
  let said = "";
  let afterTool = false;
  let nudged = false;
  let s: Session | null = null;
  const t0 = Date.now();
  let ended = false;
  await new Promise<void>(async (resolve, reject) => {
    const timer = setTimeout(resolve, 40000);
    try {
      s = await open(setup, model, setup.systemInstruction, setup.tools, (m, sess) => {
        if (m.serverContent?.inputTranscription?.text) heard += m.serverContent.inputTranscription.text;
        if (m.serverContent?.outputTranscription?.text) said += m.serverContent.outputTranscription.text;
        if (m.toolCall) {
          const responses = (m.toolCall.functionCalls ?? []).map(async (fc) => {
            const name = fc.name!;
            const args = (fc.args ?? {}) as Record<string, unknown>;
            if (name === "navigate" || name === "offer_navigation") {
              const to = pathFor(args as unknown as Destination);
              log.push(`${name} → ${"error" in to ? `ERROR ${to.error}` : to.path}`);
              return { id: fc.id, name, response: "error" in to ? { error: to.error } : { status: `Opened ${to.label} on the person's screen. Say in one short sentence what is there now.` } };
            }
            if (name === "get_screen") {
              log.push("get_screen");
              return { id: fc.id, name, response: (ctx as { screen?: unknown }).screen ?? {} };
            }
            if (name === "show_details") {
              log.push("show_details");
              return { id: fc.id, name, response: { status: "Shown on screen. Now say a short summary out loud." } };
            }
            const r = await post("/api/assistant/tool", { name, args, context: ctx });
            log.push(`${name}(${JSON.stringify(args).slice(0, 60)})`);
            return { id: fc.id, name, response: { result: r.result ?? r } };
          });
          void Promise.all(responses).then((fr) => {
            sess.sendToolResponse({ functionResponses: fr as never });
            afterTool = true;
          });
        }
        if (m.serverContent?.turnComplete) {
          if (said) {
            ended = true;
            clearTimeout(timer);
            resolve();
          } else if (afterTool && !nudged) {
            nudged = true;
            log.push("(nudged)");
            setTimeout(() => sess.sendRealtimeInput({ text: NUDGE }), 300);
          }
        }
      });
      // stream like the microphone: 100 ms chunks in real time, then a second of quiet, then end of speech
      const step = 1600;
      for (let i = 0; i < pcm.length; i += step) {
        const c = pcm.subarray(i, i + step);
        s.sendRealtimeInput({ audio: { data: Buffer.from(c.buffer, c.byteOffset, c.byteLength).toString("base64"), mimeType: "audio/pcm;rate=16000" } });
        await new Promise((r) => setTimeout(r, 100));
      }
      for (let i = 0; i < 10; i++) {
        const q = new Int16Array(1600).map((_, k) => roomy(k + i * 1600));
        const quiet = Buffer.from(q.buffer).toString("base64");
        s.sendRealtimeInput({ audio: { data: quiet, mimeType: "audio/pcm;rate=16000" } });
        await new Promise((r) => setTimeout(r, 100));
      }
      s.sendRealtimeInput({ audioStreamEnd: true });
    } catch (e) {
      reject(e);
    }
  });
  (s as Session | null)?.close();
  console.log(`\n» ${sentence}  [${model}] ${((Date.now() - t0) / 1000).toFixed(1)} s ${ended ? "" : "(no end of turn)"}`);
  console.log(`   heard: ${heard.trim() || "(nothing)"}`);
  for (const l of log) console.log(`   ${l}`);
  console.log(`   says: ${said.trim().replace(/\s+/g, " ").slice(0, 220) || "(nothing)"}`);
}

async function main() {
  const model = process.env.MODEL ?? "gemini-2.5-flash-native-audio-preview-09-2025";
  const ctx = { path: "/emr" };
  for (const s of sentences) await run(s, model, ctx).catch((e) => console.log(`\n» ${s}\n   ERROR ${(e as Error).message}`));
}
void main();
