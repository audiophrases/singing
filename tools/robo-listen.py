"""
Listens to the robot singer for tools/robo-eval.mjs.

    python tools/robo-listen.py <outDir>

For every <outDir>/<voice>-<voice|mix>/*.wav: what Whisper hears (words) and
what a phoneme recognizer hears (wav2vec2 trained on espeak IPA, no language
model), written to <outDir>/heard.json.

Needs: pip install faster-whisper transformers torch numpy scipy
The models (Systran/faster-whisper-small, facebook/wav2vec2-lv-60-espeak-cv-ft)
download once from Hugging Face and then work offline. ROBO_WHISPER picks
another Whisper size (base.en, medium...).
"""
import glob
import json
import os
import sys
import wave
from math import gcd

import numpy as np
from scipy.signal import resample_poly


def load_16k(path):
    with wave.open(path) as w:
        rate, chans, n = w.getframerate(), w.getnchannels(), w.getnframes()
        x = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768
    x = x.reshape(-1, chans).mean(axis=1)
    g = gcd(rate, 16000)
    return resample_poly(x, 16000 // g, rate // g).astype(np.float32)


def main(out_dir):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')  # IPA on a Windows console
    files = sorted(glob.glob(os.path.join(out_dir, '*', '*.wav')))
    import torch
    from faster_whisper import WhisperModel
    from huggingface_hub import hf_hub_download
    from transformers import Wav2Vec2ForCTC

    torch.set_num_threads(os.cpu_count() or 4)
    whisper = WhisperModel(os.environ.get('ROBO_WHISPER', 'small'), device='cpu', compute_type='int8')
    phone_id = 'facebook/wav2vec2-lv-60-espeak-cv-ft'
    phone_model = Wav2Vec2ForCTC.from_pretrained(phone_id).eval()
    with open(hf_hub_download(phone_id, 'vocab.json'), encoding='utf-8') as f:
        names = {i: tok for tok, i in json.load(f).items()}

    heard = []
    for i, path in enumerate(files):
        audio = load_16k(path)
        text = ''
        if not os.path.basename(path).startswith('cv-'):  # consonant tests: phonemes only
            segments, _ = whisper.transcribe(audio, language='en', beam_size=5, temperature=0,
                                             condition_on_previous_text=False, vad_filter=False,
                                             without_timestamps=True)
            text = ' '.join(s.text.strip() for s in segments)
        x = (audio - audio.mean()) / (audio.std() + 1e-7)
        with torch.no_grad():
            ids = phone_model(torch.from_numpy(x)[None]).logits[0].argmax(-1).tolist()
        # CTC: collapse repeats, drop the blank (<pad>) and the other specials.
        phones, prev = [], None
        for t in ids:
            if t != prev and t > 3:
                phones.append(names[t])
            prev = t
        rel = os.path.relpath(path, out_dir).replace('\\', '/')
        heard.append({'file': rel, 'text': text, 'phones': phones})
        if i % 25 == 0:
            print(f'{i + 1}/{len(files)} {rel}: {text} /{" ".join(phones)}/', flush=True)
    with open(os.path.join(out_dir, 'heard.json'), 'w', encoding='utf-8') as f:
        json.dump(heard, f, ensure_ascii=False, indent=0)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1])
