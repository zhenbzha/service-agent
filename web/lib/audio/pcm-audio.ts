// Microphone capture and speaker playback of mono PCM16 at 24 kHz with the Web Audio API,
// ported from the official sample (microsoft/voice-agent samples/gpt_live/js/public/pcm-audio.js).
// Two AnalyserNodes add input and output levels for the call visual.
import { CallError } from "@/lib/live/failures";
import { SAMPLE_RATE } from "@/lib/live/state";

/** Decodes base64 little-endian PCM16 into Web Audio samples. */
export function decodePcm(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  if (binary.length % 2) throw new Error("The service returned incomplete PCM16 audio.");
  const samples = new Float32Array(binary.length / 2);
  for (let i = 0; i < samples.length; i++) {
    const value = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
    samples[i] = (value >= 32768 ? value - 65536 : value) / 32768;
  }
  return samples;
}

/** Root-mean-square level (0 to 1) of an analyser's current waveform. */
function level(analyser: AnalyserNode, data: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (const value of data) sum += value * value;
  return Math.sqrt(sum / data.length);
}

// The spectrum LiveKit's radial visualizer reads (bins 100 to 200 of a 2048-point FFT at 48 kHz):
// the same bins here, since a 1024-point FFT at 24 kHz has the same bin width of 23.4 Hz.
const LOWEST_BIN = 100;
const HIGHEST_BIN = 200;
// The range of decibels that getByteFrequencyData scales to 0 to 255. In a recorded GPT-Live
// greeting, that spectrum spans about -88 dB (10th percentile) to -60 dB (99th), so this range
// lets the voice ring move from a dot to full length. LiveKit's -100 to -10 dB kept it near half.
const QUIETEST_DECIBELS = -95;
const LOUDEST_DECIBELS = -60;

export class PcmAudio {
  private readonly context: AudioContext;
  private readonly resumed: Promise<void>;
  private readonly output: AnalyserNode;
  private readonly input: AnalyserNode;
  private readonly data: Float32Array<ArrayBuffer>;
  private readonly spectrum: Uint8Array<ArrayBuffer>;
  private nextTime = 0;
  private source?: MediaStreamAudioSourceNode;
  private capture?: AudioWorkletNode;
  private silent?: GainNode;

  /** Create during a click so the browser allows audio playback. */
  constructor() {
    this.context = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.resumed = this.context.resume();
    this.output = new AnalyserNode(this.context, {
      fftSize: 1024,
      minDecibels: QUIETEST_DECIBELS,
      maxDecibels: LOUDEST_DECIBELS,
    });
    this.output.connect(this.context.destination);
    this.input = new AnalyserNode(this.context, { fftSize: 1024 });
    this.data = new Float32Array(this.output.fftSize);
    this.spectrum = new Uint8Array(this.output.frequencyBinCount);
  }

  /**
   * Sends each 100 ms microphone chunk (an ArrayBuffer of PCM16) to onChunk, with how long ago it
   * was captured: chunks queue up while the page is busy.
   */
  async startCapture(stream: MediaStream, onChunk: (chunk: ArrayBuffer, ageMs: number) => void): Promise<void> {
    await this.resumed;
    if (this.context.sampleRate !== SAMPLE_RATE) {
      throw new CallError("This browser can't run audio at 24 kHz. Use Edge or Chrome.");
    }
    await this.context.audioWorklet.addModule("/pcm-capture.js");
    this.source = this.context.createMediaStreamSource(stream);
    this.capture = new AudioWorkletNode(this.context, "pcm-capture");
    this.capture.port.onmessage = ({ data }: MessageEvent<{ audio: ArrayBuffer; time: number }>) =>
      onChunk(data.audio, Math.max(0, (this.context.currentTime - data.time) * 1000));
    // A muted path keeps the worklet and the input meter running without playing the microphone.
    this.silent = new GainNode(this.context, { gain: 0 });
    this.source.connect(this.capture);
    this.source.connect(this.input);
    this.capture.connect(this.silent);
    this.input.connect(this.silent);
    this.silent.connect(this.context.destination);
  }

  stopCapture(): void {
    if (this.capture) this.capture.port.onmessage = null;
    this.source?.disconnect();
    this.capture?.disconnect();
    this.input.disconnect();
    this.silent?.disconnect();
  }

  /** Queues a base64 PCM16 chunk right after the previous one. */
  play(base64: string): void {
    const samples = decodePcm(base64);
    if (!samples.length) return;
    const buffer = this.context.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const node = new AudioBufferSourceNode(this.context, { buffer });
    node.connect(this.output);
    const start = Math.max(this.context.currentTime + 0.05, this.nextTime);
    node.start(start);
    this.nextTime = start + buffer.duration;
  }

  /** Whether queued agent audio is still playing. */
  get playing(): boolean {
    return this.context.currentTime < this.nextTime;
  }

  /** The current microphone and agent audio levels, 0 to 1. */
  levels(): { input: number; output: number } {
    return { input: level(this.input, this.data), output: level(this.output, this.data) };
  }

  /**
   * The agent's voice in `count` frequency bands, low to high, each 0 to 1. Splits the spectrum
   * into bands as LiveKit's useMultibandTrackVolume (livekit/components-js) does for its radial
   * visualizer, and scales decibels with the analyser's own range, as MDN's visualizer example does.
   */
  voiceBands(count: number): number[] {
    this.output.getByteFrequencyData(this.spectrum);
    const bins = this.spectrum.subarray(LOWEST_BIN, HIGHEST_BIN);
    return Array.from({ length: count }, (_, band) => {
      const start = Math.floor((band * bins.length) / count);
      const end = Math.floor(((band + 1) * bins.length) / count);
      let sum = 0;
      for (let bin = start; bin < end; bin++) sum += bins[bin];
      return end > start ? sum / (end - start) / 255 : 0;
    });
  }

  close(): void {
    this.stopCapture();
    this.context.close().catch(() => {});
  }
}
