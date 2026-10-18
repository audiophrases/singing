/*
 * Make a karaoke version of a song in this browser (Demucs, see separate.js).
 *
 *   const { karaoke, vocals, info } = await makeKaraoke(blob, { onStatus, onDownload, onProgress });
 *
 * karaoke and vocals are WAV Blobs of the same recording, so the karaoke
 * version needs no lining up. Nothing leaves the computer except the model
 * download (once, then cached).
 */
import { SR, wavBlob } from './separate.js';

// What this browser can do: { ok, model: 'fp16' | 'fp32', reason }.
export async function karaokeSupport() {
  if (!navigator.gpu) return { ok: false, reason: 'This browser has no WebGPU. Chrome or Edge on a recent computer can do it.' };
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
  if (!adapter) return { ok: false, reason: 'WebGPU cannot use the graphics card on this computer.' };
  const f16 = adapter.features.has('shader-f16');
  const info = adapter.info || {};
  return { ok: true, model: f16 ? 'fp16' : 'fp32', gpu: [info.vendor, info.architecture, info.description].filter(Boolean).join(' '), f16 };
}

async function decodeStereo(blob) {
  const ctx = new OfflineAudioContext(2, 1, SR);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const left = Float32Array.from(buf.getChannelData(0));
  const right = buf.numberOfChannels > 1 ? Float32Array.from(buf.getChannelData(1)) : Float32Array.from(left);
  return { left, right };
}

export async function makeKaraoke(blob, { onStatus = () => {}, onDownload = () => {}, onProgress = () => {}, model = 'auto', backend = 'webgpu', signal } = {}) {
  onStatus('Reading the song…');
  const { left, right } = await decodeStereo(blob);
  const worker = new Worker(new URL('./separate-worker.js', import.meta.url), { type: 'module' });
  try {
    return await new Promise((resolve, reject) => {
      if (signal) signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      worker.onerror = (e) => reject(new Error(e.message || 'the karaoke maker stopped'));
      worker.onmessage = ({ data }) => {
        if (data.type === 'status') onStatus(data.text);
        else if (data.type === 'download') onDownload(data.loaded, data.total);
        else if (data.type === 'progress') onProgress(data.done, data.total);
        else if (data.type === 'error') reject(new Error(data.message));
        else if (data.type === 'done') {
          resolve({ karaoke: wavBlob(data.karaoke), vocals: wavBlob(data.vocals), info: data.info, raw: { karaoke: data.karaoke, vocals: data.vocals } });
        }
      };
      worker.postMessage({ type: 'separate', left, right, model, backend }, [left.buffer, right.buffer]);
    });
  } finally {
    worker.terminate();
  }
}
