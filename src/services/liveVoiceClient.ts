import type { CityHubId } from '../types/game';

export interface LiveVoiceCallbacks {
  onStatus: (status: 'connecting' | 'live' | 'closed' | 'error', detail?: string) => void;
  onInputTranscript: (text: string) => void;
  onOutputTranscript: (text: string) => void;
}

function floatTo16BitPcmBase64(float32: Float32Array): string {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function base64PcmToFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  const len = bin.length / 2;
  const out = new Float32Array(len);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < len; i++) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

export class LiveVoiceSession {
  private ws: WebSocket | null = null;
  private inputCtx: AudioContext | null = null;
  private outputCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private nextStartTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];

  async start(
    options: { cityId: CityHubId; npcId?: string },
    callbacks: LiveVoiceCallbacks
  ) {
    callbacks.onStatus('connecting');
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const qs = new URLSearchParams({ cityId: options.cityId });
    if (options.npcId) qs.set('npcId', options.npcId);

    this.inputCtx = new AudioContext({ sampleRate: 16000 });
    this.outputCtx = new AudioContext({ sampleRate: 24000 });
    this.nextStartTime = this.outputCtx.currentTime;

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = this.inputCtx.createMediaStreamSource(this.stream);
    this.processor = this.inputCtx.createScriptProcessor(4096, 1, 1);

    const ws = new WebSocket(`${protocol}//${location.host}/ws/live?${qs.toString()}`);
    this.ws = ws;

    ws.onopen = () => {
      source.connect(this.processor!);
      this.processor!.connect(this.inputCtx!.destination);
      this.processor!.onaudioprocess = (ev) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const b64 = floatTo16BitPcmBase64(ev.inputBuffer.getChannelData(0));
        ws.send(JSON.stringify({ audio: b64 }));
      };
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as {
          ready?: boolean;
          error?: string;
          audio?: string;
          interrupted?: boolean;
          inputTranscript?: string;
          outputTranscript?: string;
        };

        if (msg.ready) {
          callbacks.onStatus('live');
        }
        if (msg.error) {
          callbacks.onStatus('error', msg.error);
        }
        if (msg.inputTranscript) {
          callbacks.onInputTranscript(msg.inputTranscript);
        }
        if (msg.outputTranscript) {
          callbacks.onOutputTranscript(msg.outputTranscript);
        }
        if (msg.interrupted) {
          for (const s of this.activeSources) {
            try {
              s.stop();
            } catch {
              // ignore
            }
          }
          this.activeSources = [];
          if (this.outputCtx) {
            this.nextStartTime = this.outputCtx.currentTime;
          }
        }
        if (msg.audio && this.outputCtx) {
          const samples = base64PcmToFloat32(msg.audio);
          const buffer = this.outputCtx.createBuffer(1, samples.length, 24000);
          buffer.getChannelData(0).set(samples);
          const node = this.outputCtx.createBufferSource();
          node.buffer = buffer;
          node.connect(this.outputCtx.destination);

          const startAt = Math.max(this.outputCtx.currentTime, this.nextStartTime);
          node.start(startAt);
          this.nextStartTime = startAt + buffer.duration;
          this.activeSources.push(node);
          node.onended = () => {
            this.activeSources = this.activeSources.filter((s) => s !== node);
          };
        }
      } catch {
        // ignore malformed message
      }
    };

    ws.onerror = () => {
      callbacks.onStatus('error', 'Live audio connection error.');
    };

    ws.onclose = () => {
      callbacks.onStatus('closed');
    };
  }

  sendTextHint(text: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ text }));
    }
  }

  stop() {
    for (const s of this.activeSources) {
      try {
        s.stop();
      } catch {
        // ignore
      }
    }
    this.activeSources = [];
    this.processor?.disconnect();
    this.processor = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ws?.close();
    this.ws = null;
    this.inputCtx?.close().catch(() => {});
    this.outputCtx?.close().catch(() => {});
    this.inputCtx = null;
    this.outputCtx = null;
  }
}
