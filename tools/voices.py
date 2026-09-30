"""Cut real voice lines of each streamer from their public clips (the streamers approved the project).

Pipeline: Kick API top clips -> yt-dlp (audio) -> faster-whisper (Hebrew, word timestamps)
          -> pick short, clean, energetic phrases -> ffmpeg cut + loudness normalise
Output:   client/public/assets/audio/voices/<id>/{intro,win,taunt,special,hurt,ko}_N.mp3 + index.json
Review:   tools/voices/<id>.md lists every chosen line with its transcript (replace/delete freely).

Usage: python tools/voices.py [--only odedsvr,ronengg] [--clips 6]
"""
import argparse
import json
import math
import os
import re
import struct
import subprocess
import sys
import urllib.request
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = os.path.join(ROOT, 'tools', 'bin')
FFMPEG = os.path.join(BIN, 'ffmpeg.exe')
YTDLP = os.path.join(BIN, 'yt-dlp.exe')
WORK = os.path.join(ROOT, 'tools', 'voices')
OUT = os.path.join(ROOT, 'client', 'public', 'assets', 'audio', 'voices')

KICK = ['odedsvr', 'ronengg', 'igz', 'liorslife', 'psyqr', 'sasivetheboiz', 'devidtur', 'pedrofederer', 'maorameleh', 'k0nkamc', 'masterohad', 'shotist']
YOUTUBE = {'inde': ['https://www.youtube.com/watch?v=5YprobtPt8E', 'https://www.youtube.com/watch?v=GFJsH_U8Onc', 'https://www.youtube.com/watch?v=k8DNtTUN2sY']}

# never put slurs/insults/profanity into the game
BLOCK = [
    'זונה', 'זונות', 'כוס', 'כוסעמק', 'שרמוטה', 'מזדיין', 'לזיין', 'זין', 'היטלר', 'שחורים', 'ניג', 'כושי', 'קוקסינל', 'הומו', 'מפגר', 'אוטיסט',
    'ערבי מסריח', 'יא בן', 'בן זונה', 'אמא שלך', 'פרקינסון', 'אללה', 'אקבר', 'שואה', 'נאצי', 'קטינה', 'להתאבד', 'סטייק', 'קזינו', 'הימור', 'פאק', 'fuck', 'shit',
]
def use_windows_cert_store():
    # Some machines (antivirus / proxies) break certifi-based TLS; export the Windows store instead.
    import ssl
    if sys.platform != 'win32':
        return
    pem = os.path.join(WORK, 'win-ca.pem')
    os.makedirs(WORK, exist_ok=True)
    seen = set()
    with open(pem, 'w', encoding='ascii') as f:
        for store in ('ROOT', 'CA'):
            for cert, enc, _trust in ssl.enum_certificates(store):
                if enc != 'x509_asn' or cert in seen:
                    continue
                seen.add(cert)
                f.write(ssl.DER_cert_to_PEM_cert(cert))
    os.environ['SSL_CERT_FILE'] = pem
    os.environ['REQUESTS_CA_BUNDLE'] = pem
    os.environ['CURL_CA_BUNDLE'] = pem


UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36'


def blocked(text: str) -> bool:
    t = text.replace('"', '').replace("'", '')
    return any(b in t for b in BLOCK)


def kick_clips(slug: str, n: int):
    req = urllib.request.Request(f'https://kick.com/api/v2/channels/{slug}/clips?sort=view&time=all', headers={'User-Agent': UA, 'Accept': 'application/json'})
    import ssl
    ctx = ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE'))
    data = json.load(urllib.request.urlopen(req, timeout=20, context=ctx))
    clips = [c for c in data.get('clips', []) if not blocked(c.get('title', ''))]
    return [(c['id'], c.get('title', ''), f'https://kick.com/{slug}/clips/{c["id"]}') for c in clips[:n]]


def download(url: str, dest: str, section: str | None = None) -> bool:
    if os.path.exists(dest):
        return True
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    cmd = [YTDLP, '-q', '--no-warnings', '--compat-options', 'no-certifi', '-x', '--audio-format', 'wav', '--ffmpeg-location', BIN, '-o', dest.replace('.wav', '.%(ext)s'), url]
    if section:
        cmd[1:1] = ['--download-sections', section]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print('   download failed:', url, r.stderr[-300:].strip())
    return os.path.exists(dest)


def to_mono16k(src: str) -> str:
    dst = src.replace('.wav', '.16k.wav')
    if not os.path.exists(dst):
        subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', src, '-ac', '1', '-ar', '16000', dst], check=True)
    return dst


def load_pcm(path16: str):
    import numpy as np
    with wave.open(path16, 'rb') as w:
        raw = w.readframes(w.getnframes())
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def rms_db(path16: str, start: float, end: float) -> float:
    with wave.open(path16, 'rb') as w:
        sr = w.getframerate()
        w.setpos(int(max(0, start) * sr))
        n = max(1, int((end - start) * sr))
        raw = w.readframes(n)
    cnt = len(raw) // 2
    if cnt == 0:
        return -99
    vals = struct.unpack(f'<{cnt}h', raw[: cnt * 2])
    ms = sum(v * v for v in vals) / cnt
    return 10 * math.log10(ms / (32768 ** 2) + 1e-12)


def cut(src: str, start: float, end: float, dest: str):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    dur = end - start
    af = f'highpass=f=90,lowpass=f=9000,loudnorm=I=-15:TP=-1.5:LRA=7,afade=t=in:d=0.02,afade=t=out:st={max(0, dur - 0.08):.3f}:d=0.08'
    subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-ss', f'{max(0, start):.3f}', '-t', f'{dur:.3f}', '-i', src, '-ac', '1', '-af', af, '-b:a', '96k', dest], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--clips', type=int, default=6)
    ap.add_argument('--model', default='large-v3-turbo')
    args = ap.parse_args()
    only = set(filter(None, args.only.split(',')))

    use_windows_cert_store()
    from faster_whisper import WhisperModel
    print('loading whisper model', args.model, '...')
    model = WhisperModel(args.model, device='cpu', compute_type='int8')

    targets = [(s, 'kick') for s in KICK] + [(s, 'yt') for s in YOUTUBE]
    for slug, kind in targets:
        if only and slug not in only:
            continue
        print(f'== {slug}')
        sources = []
        try:
            if kind == 'kick':
                for cid, title, url in kick_clips(slug, args.clips):
                    wav = os.path.join(WORK, 'raw', slug, cid + '.wav')
                    if download(url, wav):
                        sources.append((wav, title))
            else:
                for i, url in enumerate(YOUTUBE[slug]):
                    wav = os.path.join(WORK, 'raw', slug, f'yt{i}.wav')
                    if download(url, wav, '*0:00-4:00'):
                        sources.append((wav, ''))
        except Exception as e:
            print('   source error:', e)
        cands = []
        for wav, title in sources:
            w16 = to_mono16k(wav)
            segs, _ = model.transcribe(load_pcm(w16), language='he', vad_filter=True, word_timestamps=True, beam_size=1)
            title_words = set(re.findall(r'[֐-׿a-zA-Z]{3,}', title))
            for s in segs:
                text = s.text.strip()
                if not text or blocked(text):
                    continue
                # split long segments into word-level phrases of <= 3.2s
                words = [w for w in (s.words or []) if w.word.strip()]
                chunks, cur = [], []
                for w in words:
                    if cur and (w.end - cur[0].start > 3.2 or w.start - cur[-1].end > 0.35):
                        chunks.append(cur)
                        cur = []
                    cur.append(w)
                if cur:
                    chunks.append(cur)
                for ch in chunks:
                    t = ''.join(w.word for w in ch).strip()
                    st, en = ch[0].start - 0.04, ch[-1].end + 0.08
                    dur = en - st
                    if dur < 0.3 or dur > 3.6 or blocked(t):
                        continue
                    loud = rms_db(w16, st, en)
                    prob = sum(w.probability for w in ch) / len(ch)
                    hit_title = any(tw in t for tw in title_words)
                    cands.append({'src': wav, 'start': st, 'end': en, 'dur': dur, 'text': t, 'loud': loud, 'prob': prob, 'title': hit_title})
        if not cands:
            print('   no candidates')
            continue
        used = set()

        def take(n, pred, key):
            out = []
            for c in sorted((c for c in cands if pred(c)), key=key, reverse=True):
                k = (c['src'], round(c['start'], 1))
                if k in used or c['prob'] < 0.45:
                    continue
                used.add(k)
                out.append(c)
                if len(out) >= n:
                    break
            return out

        plan = {
            'intro': take(2, lambda c: 1.0 <= c['dur'] <= 3.4, lambda c: (c['title'], c['loud'] + c['prob'] * 10)),
            'win': take(2, lambda c: 0.8 <= c['dur'] <= 3.0, lambda c: (c['title'], c['loud'])),
            'taunt': take(2, lambda c: 0.6 <= c['dur'] <= 2.5, lambda c: c['loud']),
            'special': take(3, lambda c: 0.35 <= c['dur'] <= 1.4, lambda c: c['loud']),
            'hurt': take(4, lambda c: 0.25 <= c['dur'] <= 0.9, lambda c: c['loud']),
            'ko': take(1, lambda c: 0.5 <= c['dur'] <= 2.0, lambda c: c['loud']),
        }
        files = []
        review = [f'# {slug} — קטעי קול\n', 'כל שורה = קובץ במשחק. אפשר למחוק קבצים לא מתאימים מהתיקייה ולעדכן את index.json.\n']
        for kind_name, lst in plan.items():
            for i, c in enumerate(lst):
                name = f'{kind_name}_{i + 1}.mp3'
                cut(c['src'], c['start'], c['end'], os.path.join(OUT, slug, name))
                files.append(name)
                review.append(f'- **{name}** ({c["dur"]:.1f}s): {c["text"]}')
        with open(os.path.join(OUT, slug, 'index.json'), 'w', encoding='utf8') as f:
            json.dump(files, f, ensure_ascii=False)
        os.makedirs(WORK, exist_ok=True)
        with open(os.path.join(WORK, slug + '.md'), 'w', encoding='utf8') as f:
            f.write('\n'.join(review) + '\n')
        print(f'   {len(files)} lines')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
