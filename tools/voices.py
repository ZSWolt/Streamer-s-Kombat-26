"""Cut real voice lines of each streamer from their public clips (the streamers approved the project).

Pipeline: Kick API top clips -> yt-dlp (audio) -> faster-whisper (Hebrew, word timestamps, cached)
          -> pick short, clean, energetic phrases -> ffmpeg cut + loudness normalise
Output:   client/public/assets/audio/voices/<id>/{intro,win,taunt,special,hurt,ko}_N.mp3 + index.json
Review:   tools/voices/<id>.md lists every chosen line with its transcript and source clip.
Filter:   BLOCK below + tools/voices/blocklist.txt (one word/phrase per line, editable). Re-running is fast:
          audio and transcripts are cached, so only the selection and the cuts are redone.

Usage: python -u tools/voices.py [--only odedsvr,ronengg] [--clips 6]
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

KICK = ['odedsvr', 'ronengg', 'igz', 'liorslife', 'psyqr', 'sasivetheboiz', 'devidtur', 'pedrofederer', 'maorameleh', 'masterohad', 'shotist']
YOUTUBE = {'inde': ['https://www.youtube.com/watch?v=5YprobtPt8E', 'https://www.youtube.com/watch?v=GFJsH_U8Onc', 'https://www.youtube.com/watch?v=k8DNtTUN2sY']}

# Never put slurs, insults about illness/disability, profanity, hate or gambling into the game.
# Whisper often misspells Hebrew homophones (ק/כ, ט/ת, ס/ש, ח/כ), so words are normalised before matching,
# and common misspellings that normalisation can't catch are listed explicitly.
# '=word' matches whole words only (so יאללה, עכבר, תזונה, הומור stay allowed); longer words also match inside words.
BLOCK = [
    # profanity
    '=זונה', '=זונות', 'בנזונה', 'בן זונה', 'שרמוטה', 'שרמוטות', 'שרמוט', 'שמוטה', 'שרמוטע', 'כוס', 'כוסית', 'כוסאמק', 'כוסעמק', 'כוסאמא', 'כוס אמא',
    'זין', 'זיין', 'זיינת', 'לזיין', 'מזדיין', 'מזדיינת', 'מזדיינים', 'תזדיין', 'יזדיין', 'זיון', 'זיונים', 'מניאק', 'מניאקים', 'יבן',
    'זנית', 'זנות', 'לזנות', 'זנאי', 'מוצץ', 'מצוץ', 'תמצוץ', 'חרא', 'חארות', 'פאק', 'פאקינג', 'fuck', 'shit', 'bitch', 'ביץ', 'אמא שלך', 'אחותך', 'סקס', 'פורנו',
    # racial / ethnic / lgbt slurs
    'כושי', 'כושים', 'כושית', 'כושון', 'קושים', 'קושי', 'ניגר', 'ניגרים', 'ניגה', 'nigg', 'שחורים', 'ערבוש', 'ערבושים', 'ערבי מסריח',
    'פרענק', 'צחצח', 'קוקסינל', '=הומו', 'הומואים', 'מתרומם',
    # ethnic-origin banter reads as mockery out of context
    'אשכנזי', 'אשכנזים', 'אשכנזיה', 'מרוקאי', 'מרוקאים', 'מרוקאית', '=ערבי', 'ערבים', 'ערביה', 'אתיופי', 'אתיופים', '=רוסי', 'רוסים', 'תימני', 'תימנים',
    '=פרסי', 'פרסים', 'עיראקי', 'כורדי', 'פולני', 'פולניה', 'רומני', '=דוס', 'דוסים', 'חרדי', 'חרדים', 'מזרחי', 'מזרחים',
    # illness / disability used as insults
    'סרטן', 'סרטני', 'מפגר', 'מפגרים', 'מפגרת', 'אוטיסט', 'אוטיסטי', 'אוטיסטית', 'נכה', 'נכים', 'משותק', 'מונגול', 'דאוני', 'תסמונת דאון',
    'פרקינסון', 'גמד', 'גמדים', 'רפה שכל', 'סכיזו',
    # hate / violence
    'היטלר', 'נאצי', 'נאצים', '=שואה', 'מוות לערבים', 'יהודי מסריח', 'אללה אכבר', 'להתאבד', 'תתאבד', 'התאבדות', 'אונס', 'לאנוס', 'אנס',
    'פדופיל', 'קטינה', 'קטינות', 'לרצוח', 'חותך לילד',
    # gambling
    'קזינו', 'הימור', 'הימורים', 'להמר', 'מהמר', 'הפקד', 'הפקדה', 'הפקדות', 'להפקיד', 'הפקיד', 'ספין', 'ספינים', 'סלוט', 'סלוטים', 'רולטה',
    'בונוס', 'סטייק', 'stake', 'casino', 'רולביט',
]
FINALS = str.maketrans({'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ'})
HOMOPHONES = str.maketrans({'ק': 'כ', 'ח': 'כ', 'ט': 'ת', 'ס': 'ש', 'ע': 'א'})
PREFIX = set('הובכלמש')
# another script inside a Hebrew transcript = the audio was garbled
FOREIGN = re.compile(r'[Ͱ-ϿЀ-ӿ؀-ۿ぀-ヿ一-鿿]')
BIDI = re.compile(r'[‎‏‪-‮⁦-⁩]')


def norm(s: str) -> str:
    s = BIDI.sub('', s).lower().translate(FINALS).translate(HOMOPHONES)
    return re.sub(r'[\'"׳״`\-]', '', s)


def load_block():
    words = list(BLOCK)
    extra = os.path.join(WORK, 'blocklist.txt')
    if os.path.exists(extra):
        with open(extra, encoding='utf8') as f:
            words += [l.split('#')[0].strip() for l in f if l.split('#')[0].strip()]
    phrases, short, long_ = [], set(), []
    for w in words:
        exact = w.startswith('=')
        n = norm(w.lstrip('='))
        if ' ' in n:
            phrases.append(n)
        elif exact or len(n) <= 3:
            short.add(n)
        else:
            long_.append(n)
    return phrases, short, long_


PHRASES, SHORT, LONG = [], set(), []


def blocked(text: str) -> bool:
    if FOREIGN.search(text):
        return True
    t = norm(text)
    if any(p in t for p in PHRASES):
        return True
    for tok in re.findall(r'[א-תa-z]+', t):
        forms = {tok}
        s = tok
        for _ in range(2):  # strip up to two attached prefixes (ו/ה/ב/כ/ל/מ/ש)
            if len(s) > 2 and s[0] in PREFIX:
                s = s[1:]
                forms.add(s)
        for f in forms:
            if f in SHORT or any(b in f for b in LONG):
                return True
    return False


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
        print('   download failed:', url, r.stderr[-300:].strip(), flush=True)
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
    global PHRASES, SHORT, LONG
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--clips', type=int, default=6)
    ap.add_argument('--model', default='large-v3-turbo')
    args = ap.parse_args()
    only = set(filter(None, args.only.split(',')))
    PHRASES, SHORT, LONG = load_block()

    use_windows_cert_store()
    model = None
    pcm_cache = {}

    def get_model():
        nonlocal model
        if model is None:
            from faster_whisper import WhisperModel
            print('loading whisper model', args.model, '...', flush=True)
            model = WhisperModel(args.model, device='cpu', compute_type='int8')
        return model

    def pcm(w16: str):
        if w16 not in pcm_cache:
            pcm_cache[w16] = load_pcm(w16)
        return pcm_cache[w16]

    def transcribe(w16: str):
        cache = w16.replace('.16k.wav', '.words.json')
        if os.path.exists(cache):
            with open(cache, encoding='utf8') as f:
                return json.load(f)
        segs, _ = get_model().transcribe(pcm(w16), language='he', vad_filter=True, word_timestamps=True, beam_size=1)
        out = [{'text': s.text, 'words': [[w.start, w.end, w.word, w.probability] for w in (s.words or [])]} for s in segs]
        with open(cache, 'w', encoding='utf8') as f:
            json.dump(out, f, ensure_ascii=False)
        return out

    targets = [(s, 'kick') for s in KICK] + [(s, 'yt') for s in YOUTUBE]
    for slug, kind in targets:
        if only and slug not in only:
            continue
        print(f'== {slug}', flush=True)
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
            print('   source error:', e, flush=True)
            # offline / API hiccup: fall back to whatever audio is already cached
            rawdir = os.path.join(WORK, 'raw', slug)
            if os.path.isdir(rawdir):
                sources = [(os.path.join(rawdir, f), '') for f in sorted(os.listdir(rawdir)) if f.endswith('.wav') and not f.endswith('.16k.wav')]
        cands = []
        dropped = 0
        for wav, title in sources:
            w16 = to_mono16k(wav)
            title_words = set(re.findall(r'[֐-׿a-zA-Z]{3,}', title))
            segs = transcribe(w16)
            # a blocked sentence also poisons the second around it (same breath / mis-split words)
            bad = [(s['words'][0][0] - 1.0, s['words'][-1][1] + 1.0) for s in segs if s['words'] and blocked(s['text'])]
            for s in segs:
                text = s['text'].strip()
                if not text:
                    continue
                if blocked(text):  # drop the whole sentence, not just the bad word
                    dropped += 1
                    continue
                # split long segments into word-level phrases of <= 3.2s
                words = [w for w in s['words'] if w[2].strip()]
                chunks, cur = [], []
                for w in words:
                    if cur and (w[1] - cur[0][0] > 3.2 or w[0] - cur[-1][1] > 0.35):
                        chunks.append(cur)
                        cur = []
                    cur.append(w)
                if cur:
                    chunks.append(cur)
                for ch in chunks:
                    t = BIDI.sub('', ''.join(w[2] for w in ch)).strip()
                    st, en = ch[0][0] - 0.04, ch[-1][1] + 0.08
                    dur = en - st
                    if dur < 0.3 or dur > 3.6 or blocked(t) or any(st < b1 and en > b0 for b0, b1 in bad):
                        continue
                    loud = rms_db(w16, st, en)
                    prob = sum(w[3] for w in ch) / len(ch)
                    hit_title = any(tw in t for tw in title_words)
                    cands.append({'src': wav, 'w16': w16, 'start': st, 'end': en, 'dur': dur, 'text': t, 'loud': loud, 'prob': prob, 'title': hit_title, 'clip': title})
        if not cands:
            print('   no candidates', flush=True)
            continue
        used, texts = set(), set()
        vpath = os.path.join(WORK, 'raw', slug, 'verify.json')
        vcache = {}
        if os.path.exists(vpath):
            with open(vpath, encoding='utf8') as f:
                vcache = json.load(f)
        rejected = 0

        def verify(c) -> bool:
            # Second, independent transcript of the exact cut (+ a little context) with deterministic beam
            # search. Whisper's sampling fallback can hide a word in one pass that the other pass catches.
            nonlocal rejected
            key = f"{os.path.basename(c['src'])}|{c['start']:.2f}|{c['end']:.2f}"
            if key not in vcache:
                a = pcm(c['w16'])
                seg = a[max(0, int((c['start'] - 0.4) * 16000)): int((c['end'] + 0.4) * 16000)]
                out, _ = get_model().transcribe(seg, language='he', beam_size=5, temperature=0.0, condition_on_previous_text=False, vad_filter=False)
                vcache[key] = ' '.join(x.text.strip() for x in out)
            c['text2'] = vcache[key]
            ok = not blocked(c['text2'])
            rejected += not ok
            return ok

        def take(n, pred, key):
            out = []
            for c in sorted((c for c in cands if pred(c)), key=key, reverse=True):
                k = (c['src'], round(c['start'], 1))
                tn = re.sub(r'[^א-תa-z0-9]', '', norm(c['text']))
                if k in used or tn in texts or c['prob'] < 0.55:
                    continue
                used.add(k)
                if not verify(c):
                    continue
                texts.add(tn)
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
        review = [f'# {slug} — קטעי קול\n',
                  'כל שורה = קובץ במשחק. קטע לא מתאים? הוסיפו מילה ממנו ל-tools/voices/blocklist.txt והריצו שוב (מהיר — הכל שמור במטמון).\n']
        for kind_name, lst in plan.items():
            for i, c in enumerate(lst):
                name = f'{kind_name}_{i + 1}.mp3'
                cut(c['src'], c['start'], c['end'], os.path.join(OUT, slug, name))
                files.append(name)
                src = f'  ·  _{c["clip"]}_' if c['clip'] else ''
                alt = c.get('text2', '').strip()
                alt = f'  (בדיקה חוזרת: {alt})' if alt and norm(alt) != norm(c['text']) else ''
                review.append(f'- **{name}** ({c["dur"]:.1f}s): {c["text"]}{alt}{src}')
        # remove lines from an earlier run that were not chosen this time
        for f in os.listdir(os.path.join(OUT, slug)):
            if f.endswith('.mp3') and f not in files:
                os.remove(os.path.join(OUT, slug, f))
        with open(os.path.join(OUT, slug, 'index.json'), 'w', encoding='utf8') as f:
            json.dump(files, f, ensure_ascii=False)
        with open(vpath, 'w', encoding='utf8') as f:
            json.dump(vcache, f, ensure_ascii=False)
        os.makedirs(WORK, exist_ok=True)
        with open(os.path.join(WORK, slug + '.md'), 'w', encoding='utf8') as f:
            f.write('\n'.join(review) + '\n')
        print(f'   {len(files)} lines ({len(cands)} candidates, {dropped} sentences filtered, {rejected} failed re-check)', flush=True)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
