/*
 * The karaoke maker's worker: downloads the Demucs model once (kept in the
 * browser's cache), runs it on the graphics card with ONNX Runtime Web and
 * sends back the karaoke version and the vocals. See separate.js.
 *
 * in:  { type: 'separate', left, right, model: 'auto' | 'fp16' | 'fp32', backend: 'webgpu' | 'wasm' }
 * out: { type: 'status', text } · { type: 'download', loaded, total }
 *      { type: 'progress', done, total } · { type: 'done', karaoke, vocals, info } · { type: 'error', message }
 */
import { SEG, BINS, FRAMES, separateSong } from './separate.js';

const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgpu.min.mjs';
// Pinned revisions: the model never changes under us.
const FP16 = 'https://huggingface.co/monteslu/htdemucs-web-onnx/resolve/a4a57cc0cf707e5b9a3e6ad3c2c4b21fcbe608c1/';
const FP32 = 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/92e33df61cfc9eb820272aaa62d2ef6dcf4d950d/htdemucs_embedded.onnx';
const SIZES = { fp16: 125.9e6, fp32: 180.5e6 };
// fp16 piece 0: the input normalisation must stay in fp32 on the CPU (else NaN).
const CPU_NODES = ['/ReduceMean', '/Sub', '/Pow', '/ReduceMean_1', '/Clip', '/Sqrt', '/Add', '/Div',
  '/ReduceMean_2', '/Sub_1', '/Pow_1', '/ReduceMean_3', '/Clip_1', '/Sqrt_1', '/Add_1', '/Div_1'];
const CACHE = 'singing-models-v1';

const post = (msg, transfer) => self.postMessage(msg, transfer || []);
let downloaded = 0;
let toDownload = 0;

// A model file from the cache, or downloaded (with progress) and cached.
async function fetchModel(url) {
  const cache = await caches.open(CACHE).catch(() => null);
  const hit = cache && await cache.match(url);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not download the model (${res.status})`);
  const size = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    downloaded += value.length;
    post({ type: 'download', loaded: downloaded, total: Math.max(toDownload, downloaded) });
  }
  const bytes = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { bytes.set(p, o); o += p.length; }
  if (size && got !== size) throw new Error('the model download was cut short; try again');
  if (cache) await cache.put(url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {});
  return bytes;
}

async function cachedAlready(urls) {
  const cache = await caches.open(CACHE).catch(() => null);
  if (!cache) return false;
  for (const u of urls) if (!(await cache.match(u))) return false;
  return true;
}

async function pickModel(wanted, backend) {
  if (backend === 'wasm') return 'fp32';
  if (!self.navigator.gpu) throw new Error('this browser has no WebGPU (try Chrome or Edge)');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no graphics card is available to WebGPU');
  const f16 = adapter.features.has('shader-f16');
  if (wanted === 'fp16' && !f16) throw new Error('this graphics card cannot run the fp16 model (no shader-f16)');
  return wanted === 'auto' ? (f16 ? 'fp16' : 'fp32') : wanted;
}

// Each model as a run(mix, mag) -> { x, xt } function.
async function loadFp32(ort, backend) {
  const bytes = await fetchModel(FP32);
  post({ type: 'status', text: 'Starting the model…' });
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: backend === 'wasm' ? ['wasm'] : ['webgpu'],
    graphOptimizationLevel: 'basic',
  });
  const magName = session.inputNames.find((n) => /mag|spec/i.test(n)) || session.inputNames[1];
  const mixName = session.inputNames.find((n) => n !== magName);
  return async (mix, mag) => {
    const res = await session.run({
      [mixName]: new ort.Tensor('float32', mix, [1, 2, SEG]),
      [magName]: new ort.Tensor('float32', mag, [1, 4, BINS, FRAMES]),
    });
    let x = null;
    let xt = null;
    for (const name of session.outputNames) {
      const t = res[name];
      if (t.dims.length === 5) x = t.data; else if (t.dims.length === 4) xt = t.data;
    }
    if (!x || !xt) throw new Error('the model answered in an unexpected shape');
    return { x, xt };
  };
}

async function loadFp16(ort) {
  const manifest = JSON.parse(new TextDecoder().decode(await fetchModel(`${FP16}htdemucs_split_manifest.json`)));
  const finals = new Set(Object.values(manifest.outputs));
  const sessions = [];
  for (const [i, p] of manifest.pieces.entries()) {
    const bytes = await fetchModel(FP16 + p.file);
    post({ type: 'status', text: `Starting the model (${i + 1}/${manifest.pieces.length})…` });
    sessions.push(await ort.InferenceSession.create(bytes, {
      executionProviders: [i === 0 ? { name: 'webgpu', forceCpuNodeNames: CPU_NODES } : 'webgpu'],
      graphOptimizationLevel: 'all',
      preferredOutputLocation: p.outputs.some((o) => finals.has(o)) ? 'cpu' : 'gpu-buffer',
    }));
  }
  return async (mix, mag) => {
    const map = {
      mix: new ort.Tensor('float32', mix, [1, 2, SEG]),
      mag: new ort.Tensor('float32', mag, [1, 4, BINS, FRAMES]),
    };
    const onGpu = [];
    try {
      for (const [i, p] of manifest.pieces.entries()) {
        const feeds = {};
        for (const name of p.inputs) feeds[name] = map[name];
        const res = await sessions[i].run(feeds);
        for (const name of p.outputs) {
          map[name] = res[name];
          if (res[name].location === 'gpu-buffer') onGpu.push(res[name]);
        }
      }
      return { x: map[manifest.outputs.freq].data, xt: map[manifest.outputs.time].data };
    } finally {
      onGpu.forEach((t) => t.dispose());
    }
  };
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (!msg || msg.type !== 'separate') return;
  const t0 = performance.now();
  try {
    const backend = msg.backend === 'wasm' ? 'wasm' : 'webgpu';
    const model = await pickModel(msg.model || 'auto', backend);
    post({ type: 'status', text: 'Loading ONNX Runtime…' });
    const ort = await import(ORT_URL);
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
    const files = model === 'fp16' ? [`${FP16}htdemucs_split_manifest.json`] : [FP32];
    const cached = await cachedAlready(files);
    toDownload = cached ? 0 : SIZES[model];
    post({ type: 'status', text: cached ? 'Loading the model from this browser…' : `Downloading the model (${Math.round(SIZES[model] / 1e6)} MB, only the first time)…` });
    const tLoad = performance.now();
    const run = model === 'fp16' ? await loadFp16(ort) : await loadFp32(ort, backend);
    const loadSecs = (performance.now() - tLoad) / 1000;
    post({ type: 'status', text: 'Taking the singer out…' });
    const tRun = performance.now();
    const out = await separateSong(msg.left, msg.right, run, { onProgress: (done, total) => post({ type: 'progress', done, total }) });
    const info = { model, backend, loadSecs, runSecs: (performance.now() - tRun) / 1000, totalSecs: (performance.now() - t0) / 1000, songSecs: msg.left.length / 44100 };
    post({ type: 'done', karaoke: out.karaoke, vocals: out.vocals, info }, [...out.karaoke, ...out.vocals].map((a) => a.buffer));
  } catch (err) {
    post({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
};
