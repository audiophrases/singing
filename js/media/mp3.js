/*
 * Stereo audio to an MP3 Blob, in a worker (see mp3-worker.js).
 *
 *   const blob = await mp3Blob([left, right], { rate: 44100, kbps: 192, onProgress });
 *
 * About 7x smaller than WAV at 192 kbps. Each call has its own worker, so
 * two stems can be encoded at the same time.
 */
export function mp3Blob([left, right], { rate = 44100, kbps = 192, onProgress = () => {} } = {}) {
  const worker = new Worker(new URL('./mp3-worker.js', import.meta.url));
  return new Promise((resolve, reject) => {
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'the MP3 encoder stopped')); };
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') onProgress(data.done, data.total);
      else if (data.type === 'error') { worker.terminate(); reject(new Error(data.message)); }
      else if (data.type === 'done') { worker.terminate(); resolve(new Blob(data.parts, { type: 'audio/mpeg' })); }
    };
    worker.postMessage({ left, right, rate, kbps });
  });
}
