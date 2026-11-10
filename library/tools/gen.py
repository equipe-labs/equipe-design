#!/usr/bin/env python3
"""T-291 generator: 30 original design systems -> tokens.json, preview PNG, contrast table, contact sheet.
Run: python3 gen.py <out_dir>   (needs `equipe design render` and Pillow)"""
import json, os, sys, colorsys, subprocess, math, shutil
from PIL import Image

OUT = sys.argv[1]
TMP = "/tmp/t291/work"
os.makedirs(TMP, exist_ok=True)

# ---------- colour helpers ----------
def h2r(h): h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
def r2h(c): return '#%02x%02x%02x' % tuple(max(0, min(255, round(v))) for v in c)
def lin(v): v /= 255; return v/12.92 if v <= .03928 else ((v+.055)/1.055)**2.4
def lum(h): r, g, b = h2r(h); return .2126*lin(r)+.7152*lin(g)+.0722*lin(b)
def ratio(a, b):
    la, lb = lum(a), lum(b); hi, lo = max(la, lb), min(la, lb); return (hi+.05)/(lo+.05)
def mix(a, b, t):
    x, y = h2r(a), h2r(b); return r2h([x[i]*(1-t)+y[i]*t for i in range(3)])
def shift(h, dl):
    r, g, b = [v/255 for v in h2r(h)]; H, L, S = colorsys.rgb_to_hls(r, g, b)
    L = max(0, min(1, L+dl)); return r2h([v*255 for v in colorsys.hls_to_rgb(H, L, S)])
def ensure(fg, bgs, target):
    """move fg lightness away from the bgs until it meets target on all of them"""
    bgs = bgs if isinstance(bgs, list) else [bgs]
    avg = sum(lum(b) for b in bgs)/len(bgs)
    d = -0.01 if avg > .3 else 0.01
    c = fg
    for _ in range(100):
        if all(ratio(c, b) >= target for b in bgs): return c
        c = shift(c, d)
    return c
def best_on(bg, cands):
    return max(cands, key=lambda c: ratio(c, bg))

SEM = {  # semantic seeds per mode
    'light': dict(destructive='#c62828', success='#1b7a43', warning='#8f5b00'),
    'dark': dict(destructive='#ff7b72', success='#4cc38a', warning='#e8b44a'),
}

def build_mode(mode, s, extra):
    dark = mode == 'dark'
    bg, ink = s['bg'], s['ink']
    surface = s.get('surface') or (mix(bg, '#ffffff', .05) if dark else mix(bg, ink, .035))
    raised = s.get('raised') or (mix(bg, '#ffffff', .10) if dark else ('#ffffff' if lum(bg) < .98 and extra.get('white_raised', True) else mix(bg, ink, .02)))
    text = ensure(ink, [bg, surface, raised], 7 if extra.get('aaa') else 4.5)
    muted = ensure(mix(text, bg, .38), [bg, surface, raised], 4.5)
    sec = s['sec']; text_sec_ok = ensure(text, [sec], 4.5)
    if ratio(text, sec) < 4.5:  # secondary is a quiet fill: push it toward bg so text reads
        sec = mix(sec, bg, .35)
        for _ in range(20):
            if ratio(text, sec) >= 4.5: break
            sec = mix(sec, bg, .2)
    pri = ensure(s['pri'], bg, 3.0)
    onp = best_on(pri, [bg, text, '#ffffff', '#000000'])
    for _ in range(60):  # make on-primary reach AA by moving primary away from it
        if ratio(onp, pri) >= 4.5: break
        pri = shift(pri, -0.01 if lum(onp) > lum(pri) else 0.01)
        onp = best_on(pri, [bg, text, '#ffffff', '#000000'])
    acc = ensure(s['acc'], [bg, surface, raised], 4.5)
    border = mix(bg, ink, .22 if extra.get('bold_border') else .13)
    bstrong = ensure(mix(bg, ink, .55), bg, 3.0)
    ring = ensure(s.get('ring') or pri, bg, 3.0)
    sem = {k: ensure(v, [bg, surface, raised], 4.5) for k, v in SEM[mode].items()}
    return dict(background=bg, surface=surface, raised=raised, text=text, **{'muted-text': muted},
                primary=pri, **{'on-primary': onp}, secondary=sec, accent=acc, border=border,
                **{'border-strong': bstrong}, ring=ring, **sem)

ROLES = ['background', 'surface', 'raised', 'text', 'muted-text', 'primary', 'on-primary', 'secondary',
         'accent', 'border', 'border-strong', 'ring', 'destructive', 'success', 'warning']

def checks(m):
    P = [('text', 'background', 4.5), ('text', 'surface', 4.5), ('text', 'raised', 4.5),
         ('muted-text', 'background', 4.5), ('muted-text', 'surface', 4.5),
         ('on-primary', 'primary', 4.5), ('text', 'secondary', 4.5), ('primary', 'background', 3.0),
         ('accent', 'background', 4.5), ('destructive', 'background', 4.5), ('success', 'background', 4.5),
         ('warning', 'background', 4.5), ('border-strong', 'background', 3.0), ('ring', 'background', 3.0)]
    return [(a, b, t, ratio(m[a], m[b])) for a, b, t in P]

# ---------- systems ----------
# font tuple: (display, body, google-css-query, mono?)  all OFL via Google Fonts
SH = 'shadow'
SYSTEMS = [
 dict(id='Hush', ko='미니멀', L=dict(bg='#ffffff', ink='#1a1a1a', pri='#2b2b2b', sec='#f1f1f1', acc='#2456c9'),
      D=dict(bg='#111113', ink='#eeeeee', pri='#f2f2f2', sec='#26262a', acc='#8ab0ff'),
      font=('Hanken Grotesk', 'Hanken Grotesk', 'Hanken+Grotesk:wght@400;500;700'), rad=(4, 6, 10), sp=4, ratio=1.2, body=16, bw=1, sh='soft', mo='smooth', hw=600, ls=-0.01),
 dict(id='Cornice', ko='브루탈', L=dict(bg='#ffffff', ink='#000000', pri='#1d1dff', sec='#ffe600', acc='#d4002a'),
      D=dict(bg='#000000', ink='#ffffff', pri='#6b6bff', sec='#1f1f1f', acc='#ffe600'),
      font=('Archivo Black', 'Space Grotesk', 'Archivo+Black&family=Space+Grotesk:wght@400;500;700'), rad=(0, 0, 0), sp=8, ratio=1.333, body=16, bw=3, sh='hard', mo='instant', hw=400, ls=-0.02, bold=True),
 dict(id='Hearth', ko='따뜻한', L=dict(bg='#fff1e6', ink='#3b2418', pri='#b4411f', sec='#f6d9c3', acc='#5b6b1f'),
      D=dict(bg='#1f1511', ink='#f7e6d8', pri='#e8774f', sec='#3a2820', acc='#b8c96a'),
      font=('Bricolage Grotesque', 'Nunito Sans', 'Bricolage+Grotesque:wght@500;700&family=Nunito+Sans:wght@400;600'), rad=(10, 16, 24), sp=4, ratio=1.25, body=16, bw=1, sh='soft', mo='smooth', hw=700, ls=-0.015),
 dict(id='Klaxon', ko='고대비', L=dict(bg='#ffffff', ink='#000000', pri='#0000cc', sec='#ffdd00', acc='#b00020'),
      D=dict(bg='#000000', ink='#ffffff', pri='#ffdd00', sec='#222222', acc='#66ccff'),
      font=('Atkinson Hyperlegible', 'Atkinson Hyperlegible', 'Atkinson+Hyperlegible:wght@400;700'), rad=(2, 4, 6), sp=8, ratio=1.25, body=18, bw=3, sh='none', mo='instant', hw=700, ls=0, aaa=True, bold=True),
 dict(id='Mallow', ko='파스텔', L=dict(bg='#fdf3fa', ink='#3a2e4a', pri='#7b5cc4', sec='#e6dcf7', acc='#c2418d'),
      D=dict(bg='#1b1626', ink='#f1e9fb', pri='#b9a1f2', sec='#2f2640', acc='#f08cc4'),
      font=('Quicksand', 'Nunito', 'Quicksand:wght@500;700&family=Nunito:wght@400;600'), rad=(12, 18, 28), sp=4, ratio=1.2, body=16, bw=1, sh='soft', mo='spring', hw=700, ls=0),
 dict(id='Pewter', ko='모노', L=dict(bg='#f2f5f0', ink='#0f1a0f', pri='#146b2e', sec='#e1e8de', acc='#7a4b00'),
      D=dict(bg='#0b0f0b', ink='#c8f5c8', pri='#5cf28a', sec='#162016', acc='#f2c14e'),
      font=('JetBrains Mono', 'JetBrains Mono', 'JetBrains+Mono:wght@400;500;700'), rad=(0, 2, 4), sp=4, ratio=1.125, body=15, bw=1, sh='none', mo='instant', hw=700, ls=0),
 dict(id='Woofer', ko='레트로', L=dict(bg='#f8ecff', ink='#1c0a3a', pri='#d3118f', sec='#d6f3ff', acc='#006c9c'),
      D=dict(bg='#14062e', ink='#ffe9ff', pri='#ff4fc3', sec='#2b1457', acc='#3de0ff'),
      font=('Righteous', 'DM Sans', 'Righteous&family=DM+Sans:wght@400;500;700'), rad=(6, 10, 16), sp=4, ratio=1.25, body=16, bw=2, sh='hard-color', mo='spring', hw=400, ls=0.01),
 dict(id='Guild', ko='기업용', L=dict(bg='#f2f4f8', ink='#14213d', pri='#1f4ea3', sec='#e3e9f4', acc='#0b6e8a'),
      D=dict(bg='#0f1623', ink='#e6ebf5', pri='#5b8fe0', sec='#1d2a40', acc='#5cc3de'),
      font=('IBM Plex Sans', 'IBM Plex Sans', 'IBM+Plex+Sans:wght@400;500;600'), rad=(3, 5, 8), sp=4, ratio=1.2, body=15, bw=1, sh='soft', mo='smooth', hw=600, ls=0),
 dict(id='Bloop', ko='놀이형', L=dict(bg='#fffbe6', ink='#2a2a40', pri='#ff5a36', sec='#cdeeff', acc='#0a62d4'),
      D=dict(bg='#15152b', ink='#fff8dc', pri='#ff7a59', sec='#26264a', acc='#5ec8ff'),
      font=('Fredoka', 'Nunito', 'Fredoka:wght@500;700&family=Nunito:wght@400;700'), rad=(14, 22, 32), sp=4, ratio=1.25, body=16, bw=2, sh='hard', mo='spring', hw=700, ls=0),
 dict(id='Verso', ko='에디토리얼', L=dict(bg='#ffffff', ink='#111111', pri='#c8102e', sec='#f1f1f1', acc='#0b3d91'),
      D=dict(bg='#0d0d0d', ink='#f4f1ec', pri='#ff5a6e', sec='#222222', acc='#8fb4ff'),
      font=('Bodoni Moda', 'Source Sans 3', 'Bodoni+Moda:wght@500;700&family=Source+Sans+3:wght@400;600'), rad=(0, 0, 0), sp=8, ratio=1.333, body=17, bw=1, sh='none', mo='slow', hw=700, ls=-0.02),
 dict(id='Lichen', ko='자연', L=dict(bg='#eef4ea', ink='#1c2b1e', pri='#2f6b3a', sec='#d9e7d2', acc='#3b6f6b'),
      D=dict(bg='#101a12', ink='#e3efe0', pri='#7ac28a', sec='#1f3023', acc='#9ad5cf'),
      font=('Albert Sans', 'Albert Sans', 'Albert+Sans:wght@400;500;700'), rad=(8, 14, 22), sp=4, ratio=1.2, body=16, bw=1, sh='soft', mo='slow', hw=600, ls=-0.01),
 dict(id='Brine', ko='바다', L=dict(bg='#eef7f9', ink='#0b2a35', pri='#0e7490', sec='#d5eaf0', acc='#c2410c'),
      D=dict(bg='#07161c', ink='#dcf1f6', pri='#4cc3dd', sec='#12303b', acc='#ff9b6b'),
      font=('Sora', 'Sora', 'Sora:wght@400;500;700'), rad=(6, 10, 16), sp=4, ratio=1.2, body=15, bw=1, sh='soft', mo='smooth', hw=700, ls=-0.01),
 dict(id='Gloaming', ko='노을', L=dict(bg='#fff3ee', ink='#36121f', pri='#c2255c', sec='#ffd9c9', acc='#b45309'),
      D=dict(bg='#1d0e18', ink='#ffe8dc', pri='#ff7a8a', sec='#3a1a2c', acc='#ffb347'),
      font=('Red Hat Display', 'Red Hat Text', 'Red+Hat+Display:wght@500;800&family=Red+Hat+Text:wght@400;600'), rad=(8, 14, 22), sp=4, ratio=1.25, body=16, bw=1, sh='glow', mo='smooth', hw=800, ls=-0.015),
 dict(id='Selvedge', ko='종이 인쇄물', L=dict(bg='#eceae3', ink='#1b2a4a', pri='#23407a', sec='#d9d6cc', acc='#8a2b2b'),
      D=dict(bg='#14181f', ink='#e8e6df', pri='#8fabe8', sec='#232a36', acc='#e89b8f'),
      font=('Libre Franklin', 'Libre Baskerville', 'Libre+Franklin:wght@600;800&family=Libre+Baskerville:wght@400;700'), rad=(1, 2, 3), sp=4, ratio=1.25, body=16, bw=1, sh='line', mo='slow', hw=800, ls=-0.01, white_raised=False),
 dict(id='Enamel', ko='반투명 유리', L=dict(bg='#e6f0f5', ink='#0d2230', pri='#0b6e99', sec='#cfe3ee', acc='#a8326e'),
      D=dict(bg='#08141c', ink='#e3f1f8', pri='#52b6e0', sec='#17303f', acc='#f08cb8'),
      font=('Plus Jakarta Sans', 'Plus Jakarta Sans', 'Plus+Jakarta+Sans:wght@400;500;700'), rad=(12, 20, 32), sp=4, ratio=1.2, body=15, bw=1, sh='glow', mo='smooth', hw=700, ls=-0.01),
 dict(id='Flicker', ko='사이버 네온', L=dict(bg='#eef0ff', ink='#0a0a23', pri='#5b21d6', sec='#dcdcfa', acc='#b0125b'),
      D=dict(bg='#05050f', ink='#eafffb', pri='#00f0c8', sec='#151530', acc='#ff2e97'),
      font=('Chakra Petch', 'Chakra Petch', 'Chakra+Petch:wght@400;500;700'), rad=(0, 2, 4), sp=4, ratio=1.25, body=15, bw=1, sh='glow', mo='snappy', hw=700, ls=0.02),
 dict(id='Plumb', ko='스위스 그리드', L=dict(bg='#ffffff', ink='#111111', pri='#e30613', sec='#ededed', acc='#0050b3'),
      D=dict(bg='#111111', ink='#f5f5f5', pri='#ff4b55', sec='#262626', acc='#6fb0ff'),
      font=('Work Sans', 'Work Sans', 'Work+Sans:wght@400;500;700'), rad=(0, 0, 0), sp=8, ratio=1.333, body=16, bw=2, sh='none', mo='snappy', hw=700, ls=-0.02),
 dict(id='Anneal', ko='손맛', L=dict(bg='#f2e8dc', ink='#2b2118', pri='#1f6f78', sec='#ead9c4', acc='#a23b2a'),
      D=dict(bg='#1c1612', ink='#f1e6d8', pri='#5cbdc7', sec='#33281f', acc='#e8806c'),
      font=('Caveat', 'Karla', 'Caveat:wght@500;700&family=Karla:wght@400;600'), rad=(10, 14, 20), sp=4, ratio=1.25, body=16, bw=2, sh='soft', mo='smooth', hw=700, ls=0),
 dict(id='Abacus', ko='차분한 금융', L=dict(bg='#f6f8f7', ink='#10231c', pri='#0f6b4f', sec='#e0ece7', acc='#1d4f91'),
      D=dict(bg='#0b1511', ink='#e4f0eb', pri='#4fc39a', sec='#17291f', acc='#7fb0ee'),
      font=('Public Sans', 'Public Sans', 'Public+Sans:wght@400;500;700'), rad=(4, 8, 12), sp=4, ratio=1.2, body=15, bw=1, sh='soft', mo='smooth', hw=700, ls=0),
 dict(id='Gumdrop', ko='어린이', L=dict(bg='#ffffff', ink='#1d1b3a', pri='#6d28d9', sec='#ffe08a', acc='#e11d74'),
      D=dict(bg='#1a1033', ink='#ffffff', pri='#b794ff', sec='#382a63', acc='#ff7ab8'),
      font=('Baloo 2', 'Nunito', 'Baloo+2:wght@600;800&family=Nunito:wght@400;700'), rad=(16, 24, 36), sp=4, ratio=1.333, body=17, bw=3, sh='hard-color', mo='spring', hw=800, ls=0),
 dict(id='Gilt', ko='럭셔리', L=dict(bg='#f7f5f2', ink='#1a1712', pri='#7a5c12', sec='#ebe5d8', acc='#6b1f2a'),
      D=dict(bg='#0e0d0b', ink='#f1ead8', pri='#d4af37', sec='#24211a', acc='#e0a0a8'),
      font=('Cormorant Garamond', 'Jost', 'Cormorant+Garamond:wght@500;700&family=Jost:wght@400;500'), rad=(0, 1, 2), sp=8, ratio=1.333, body=16, bw=1, sh='none', mo='slow', hw=700, ls=0.02),
 dict(id='Saline', ko='의료·청결', L=dict(bg='#f2fafb', ink='#12333a', pri='#0a7f8c', sec='#d8eef1', acc='#1459b3'),
      D=dict(bg='#0a1a1d', ink='#dff3f5', pri='#4fd0dc', sec='#153238', acc='#7fb2f5'),
      font=('Mulish', 'Mulish', 'Mulish:wght@400;600;800'), rad=(6, 10, 14), sp=4, ratio=1.2, body=16, bw=1, sh='soft', mo='smooth', hw=800, ls=0),
 dict(id='Dowel', ko='실용·군용', L=dict(bg='#e9e9e2', ink='#1e211a', pri='#4a5d23', sec='#d1d3c4', acc='#b34700'),
      D=dict(bg='#15170f', ink='#e5e8d6', pri='#a9c25a', sec='#2a2e1d', acc='#ff9a4a'),
      font=('Barlow Condensed', 'Barlow', 'Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500;600'), rad=(2, 3, 4), sp=4, ratio=1.25, body=16, bw=2, sh='hard', mo='snappy', hw=700, ls=0.02, bold=True),
 dict(id='Masthead', ko='신문', L=dict(bg='#ffffff', ink='#111111', pri='#0b2a5b', sec='#efefef', acc='#b3001b'),
      D=dict(bg='#121212', ink='#eeeeee', pri='#8fb3ff', sec='#262626', acc='#ff6b6b'),
      font=('Old Standard TT', 'Roboto Condensed', 'Old+Standard+TT:wght@400;700&family=Roboto+Condensed:wght@400;700'), rad=(0, 0, 0), sp=4, ratio=1.2, body=15, bw=1, sh='line', mo='instant', hw=700, ls=0, bold=True),
 dict(id='Plush', ko='말랑 입체', L=dict(bg='#e4e8ef', ink='#2a3140', pri='#4a5fa8', sec='#d6dbe6', acc='#a8325a'),
      D=dict(bg='#1e222b', ink='#e6e9f0', pri='#8ea2e8', sec='#2b303c', acc='#f08aa8'),
      font=('Lexend', 'Lexend', 'Lexend:wght@400;500;600'), rad=(14, 20, 28), sp=4, ratio=1.2, body=16, bw=0, sh='neu', mo='smooth', hw=600, ls=-0.01, white_raised=False),
 dict(id='Taffy', ko='Y2K 캔디', L=dict(bg='#fff0f8', ink='#3b0a2e', pri='#e0197d', sec='#d4fbe8', acc='#0a7a5a'),
      D=dict(bg='#240a1c', ink='#ffe6f5', pri='#ff5fb0', sec='#3d1636', acc='#7affc4'),
      font=('Rubik', 'Rubik', 'Rubik:wght@400;500;700'), rad=(16, 24, 999), sp=4, ratio=1.25, body=16, bw=2, sh='hard-color', mo='spring', hw=700, ls=0),
 dict(id='Umber', ko='흙빛', L=dict(bg='#e8dccd', ink='#2e1c12', pri='#8a3b1a', sec='#d9c6b0', acc='#4d6a2f'),
      D=dict(bg='#1a110c', ink='#ecdcc9', pri='#d9835a', sec='#33241a', acc='#a3c07a'),
      font=('Zilla Slab', 'Mukta', 'Zilla+Slab:wght@500;700&family=Mukta:wght@400;600'), rad=(4, 8, 12), sp=4, ratio=1.25, body=16, bw=1, sh='soft', mo='slow', hw=700, ls=0, white_raised=False),
 dict(id='Nocturne', ko='한밤 엔터프라이즈', L=dict(bg='#f4f6fb', ink='#0e1a33', pri='#2748c8', sec='#dfe5f5', acc='#007a8a'),
      D=dict(bg='#0a1020', ink='#e2e8f7', pri='#6a8cff', sec='#18233d', acc='#3dd6c6'),
      font=('Onest', 'Onest', 'Onest:wght@400;500;600'), rad=(4, 6, 10), sp=4, ratio=1.2, body=14, bw=1, sh='soft', mo='snappy', hw=600, ls=-0.01),
 dict(id='Pastiche', ko='베이퍼웨이브', L=dict(bg='#e6f7f4', ink='#1c2442', pri='#bf1e7f', sec='#ffe0f0', acc='#1b5fd1'),
      D=dict(bg='#101a2e', ink='#e6f7f4', pri='#ff6fc0', sec='#24315a', acc='#5be4d0'),
      font=('Syne', 'Outfit', 'Syne:wght@600;800&family=Outfit:wght@400;500;600'), rad=(0, 12, 24), sp=4, ratio=1.333, body=16, bw=2, sh='hard-color', mo='smooth', hw=800, ls=-0.02),
 dict(id='Sumi', ko='선(禪) 먹빛', L=dict(bg='#f5f5f2', ink='#14110f', pri='#c8321e', sec='#e6e6e1', acc='#345c8a'),
      D=dict(bg='#0f0f0e', ink='#ecebe6', pri='#e8553e', sec='#232321', acc='#8fb0d4'),
      font=('Zen Old Mincho', 'Zen Kaku Gothic New', 'Zen+Old+Mincho:wght@500;700&family=Zen+Kaku+Gothic+New:wght@400;500;700'), rad=(0, 2, 4), sp=8, ratio=1.25, body=16, bw=1, sh='none', mo='slow', hw=700, ls=0),
]

MOTION = {
  'instant': ((0, 80, 120), [0, 0, 1, 1]),
  'snappy': ((90, 160, 240), [0.2, 0, 0, 1]),
  'smooth': ((140, 240, 400), [0.4, 0, 0.2, 1]),
  'slow': ((200, 360, 600), [0.25, 0.1, 0.25, 1]),
  'spring': ((160, 280, 480), [0.34, 1.56, 0.64, 1]),
}

def shadow_tokens(kind, m, mode):
    dark = mode == 'dark'
    blk = '#000000' + ('66' if dark else '1a')
    if kind == 'none': return [dict(color='#00000000', offsetX='0px', offsetY='0px', blur='0px', spread='0px')]
    if kind == 'soft': return [dict(color=blk, offsetX='0px', offsetY='4px', blur='14px', spread='0px')]
    if kind == 'hard': return [dict(color=m['text'], offsetX='4px', offsetY='4px', blur='0px', spread='0px')]
    if kind == 'hard-color': return [dict(color=m['primary'], offsetX='4px', offsetY='4px', blur='0px', spread='0px')]
    if kind == 'line': return [dict(color=m['border'], offsetX='0px', offsetY='1px', blur='0px', spread='0px')]
    if kind == 'glow': return [dict(color=m['primary'] + ('55' if dark else '33'), offsetX='0px', offsetY='0px', blur='20px', spread='0px')]
    if kind == 'neu':
        hi = '#ffffff' + ('0f' if dark else 'cc'); lo = '#000000' + ('88' if dark else '30')
        return [dict(color=lo, offsetX='6px', offsetY='6px', blur='12px', spread='0px'), dict(color=hi, offsetX='-6px', offsetY='-6px', blur='12px', spread='0px')]

def make(sysd):
    ex = dict(aaa=sysd.get('aaa'), bold_border=sysd.get('bold'), white_raised=sysd.get('white_raised', True))
    mL = build_mode('light', sysd['L'], ex); mD = build_mode('dark', sysd['D'], ex)
    base = sysd['body']; r = sysd['ratio']
    steps = [('xs', -2), ('sm', -1), ('md', 0), ('lg', 1), ('xl', 2), ('2xl', 3), ('3xl', 4), ('4xl', 5)]
    fs = {k: {'$type': 'dimension', '$value': f'{round(base*(r**n))}px'} for k, n in steps}
    sp = sysd['sp']
    spacing = {str(i+1): {'$type': 'dimension', '$value': f'{round(sp*f, 1):g}px'} for i, f in enumerate([.5, 1, 2, 3, 4, 6, 8, 12])}
    rs, rm, rl = sysd['rad']
    radius = {k: {'$type': 'dimension', '$value': f'{v}px'} for k, v in dict(sm=rs, md=rm, lg=rl, full=9999).items()}
    d, bfont, q = sysd['font']
    stack = lambda f, gen: [f, 'Pretendard', 'Noto Sans KR', gen]
    disp_gen = 'serif' if sysd['id'] in ('Verso', 'Gilt', 'Masthead', 'Umber', 'Sumi') else 'sans-serif'
    body_gen = 'serif' if sysd['id'] in ('Selvedge',) else 'sans-serif'
    if sysd['id'] == 'Pewter': disp_gen = body_gen = 'monospace'
    ftype = {
        'family': {'display': {'$type': 'fontFamily', '$value': stack(d, disp_gen)},
                   'body': {'$type': 'fontFamily', '$value': stack(bfont, body_gen)}},
        'weight': {'regular': {'$type': 'fontWeight', '$value': 400}, 'heading': {'$type': 'fontWeight', '$value': sysd['hw']}},
        'lineHeight': {'body': {'$type': 'number', '$value': 1.6}, 'heading': {'$type': 'number', '$value': 1.25}},
        'letterSpacing': {'heading': {'$type': 'dimension', '$value': f"{sysd['ls']}em"}, 'body': {'$type': 'dimension', '$value': '0em'}},
        'size': fs,
    }
    dur, ease = MOTION[sysd['mo']]
    motion = {'duration': {k: {'$type': 'duration', '$value': f'{v}ms'} for k, v in zip(['fast', 'base', 'slow'], dur)},
              'easing': {'standard': {'$type': 'cubicBezier', '$value': ease}}}
    colors = {mode: {k: {'$type': 'color', '$value': m[k]} for k in ROLES} for mode, m in (('light', mL), ('dark', mD))}
    shL, shD = shadow_tokens(sysd['sh'], mL, 'light'), shadow_tokens(sysd['sh'], mD, 'dark')
    tokens = {
        '$description': f"{sysd['id']} — {sysd['ko']} 스타일. equipe design library original. Fonts: {d} / {bfont} (OFL, Google Fonts); Korean fallback Pretendard / Noto Sans KR (OFL).",
        'color': colors,
        'spacing': spacing,
        'radius': radius,
        'border': {'width': {'$type': 'dimension', '$value': f"{sysd['bw']}px"}},
        'typography': ftype,
        'shadow': {'md': {'$type': 'shadow', '$value': shL, '$extensions': {'mode': {'dark': shD}}}},
        'motion': motion,
        '$extensions': {'equipe.library': {'name': sysd['id'], 'genre': sysd['ko'], 'origin': 'original', 'fontLicense': 'OFL-1.1'}},
    }
    return tokens, mL, mD

def css_shadow(sh):
    return ','.join(f"{s['offsetX']} {s['offsetY']} {s['blur']} {s['spread']} {s['color']}" for s in sh)

def panel(sysd, tk, mode, m):
    t = tk
    fs = {k: v['$value'] for k, v in t['typography']['size'].items()}
    sp = {k: v['$value'] for k, v in t['spacing'].items()}
    rad = {k: v['$value'] for k, v in t['radius'].items()}
    shd = css_shadow(t['shadow']['md']['$value'] if mode == 'light' else t['shadow']['md']['$extensions']['mode']['dark'])
    f = t['typography']['family']
    disp = ','.join(f"'{x}'" if ' ' in x else x for x in f['display']['$value'])
    body = ','.join(f"'{x}'" if ' ' in x else x for x in f['body']['$value'])
    bw = t['border']['width']['$value']
    dur = t['motion']['duration']['base']['$value']
    c = lambda k: m[k]
    neu = sysd['sh'] == 'neu'
    ctl_border = f"{bw} solid {c('border-strong')}" if bw != '0px' else 'none'
    cardb = f"{bw} solid {c('border')}" if bw != '0px' else 'none'
    btn_shadow = f"box-shadow:{shd};" if sysd['sh'] in ('hard', 'hard-color', 'neu') else ''
    return f"""
<section style="background:{c('background')};color:{c('text')};padding:{sp['6']};width:560px;box-sizing:border-box;font-family:{body};font-size:{fs['md']};line-height:1.6;word-break:keep-all;overflow-wrap:anywhere">
 <div style="display:flex;justify-content:space-between;align-items:baseline;color:{c('muted-text')};font-size:{fs['xs']};letter-spacing:.06em;text-transform:uppercase">
   <span>{sysd['id']} · {mode}</span><span>{sysd['ko']}</span></div>
 <h1 style="font-family:{disp};font-weight:{t['typography']['weight']['heading']['$value']};font-size:{fs['3xl']};line-height:1.15;letter-spacing:{t['typography']['letterSpacing']['heading']['$value']};margin:{sp['4']} 0 {sp['2']}">승인할 일 3건</h1>
 <h2 style="font-family:{disp};font-weight:{t['typography']['weight']['heading']['$value']};font-size:{fs['lg']};margin:0 0 {sp['2']};color:{c('accent')}">Three things need you today</h2>
 <p style="margin:0 0 {sp['4']}">오늘 팀이 만든 결과를 확인하고 승인만 하세요. <span style="color:{c('muted-text')};font-size:{fs['sm']}">마지막 갱신 11월 2일 · 14:20</span></p>
 <div style="display:flex;gap:{sp['3']};flex-wrap:wrap;margin-bottom:{sp['5']}">
  <button style="font:inherit;font-weight:600;padding:{sp['3']} {sp['5']};border-radius:{rad['md']};border:{bw} solid {c('primary') if not neu else 'transparent'};background:{c('primary')};color:{c('on-primary')};{btn_shadow}transition:all {dur}">승인하기</button>
  <button style="font:inherit;font-weight:600;padding:{sp['3']} {sp['5']};border-radius:{rad['md']};border:{ctl_border};background:{c('secondary')};color:{c('text')};{btn_shadow if neu else ''}">나중에</button>
  <button style="font:inherit;font-weight:600;padding:{sp['3']} {sp['5']};border-radius:{rad['md']};border:{bw} solid {c('destructive')};background:transparent;color:{c('destructive')}">삭제</button>
 </div>
 <label style="display:block;font-size:{fs['sm']};font-weight:600;margin-bottom:{sp['2']}">프로젝트 이름</label>
 <div style="padding:{sp['3']} {sp['4']};border-radius:{rad['md']};border:{ctl_border};background:{c('raised')};color:{c('text')};box-shadow:0 0 0 3px {c('ring')}55;outline:2px solid {c('ring')};outline-offset:1px;margin-bottom:{sp['5']}">equipe-site</div>
 <div style="padding:{sp['5']};border-radius:{rad['lg']};border:{cardb};background:{c('surface') if not neu else c('background')};box-shadow:{shd}">
  <div style="display:flex;gap:{sp['2']};margin-bottom:{sp['3']}">
   <span style="font-size:{fs['xs']};font-weight:700;padding:2px 10px;border-radius:{rad['full']};background:{c('secondary')};color:{c('success')}">● 배포됨</span>
   <span style="font-size:{fs['xs']};font-weight:700;padding:2px 10px;border-radius:{rad['full']};background:{c('secondary')};color:{c('warning')}">▲ 확인 필요</span></div>
  <div style="font-family:{disp};font-weight:{t['typography']['weight']['heading']['$value']};font-size:{fs['xl']};letter-spacing:{t['typography']['letterSpacing']['heading']['$value']}">가격표 페이지 개편</div>
  <p style="margin:{sp['2']} 0 {sp['3']};color:{c('muted-text')};font-size:{fs['sm']}">디자이너가 시안 3개를 올렸어요. 결제 전환율은 <b style="color:{c('text')};font-variant-numeric:tabular-nums">3.2%</b> → <b style="color:{c('text')};font-variant-numeric:tabular-nums">4.1%</b> 예상.</p>
  <a style="color:{c('accent')};font-weight:600;text-decoration:underline;font-size:{fs['sm']}">시안 보기 →</a>
 </div>
</section>"""

def preview_html(sysd, tk, mL, mD):
    return f"""<!doctype html><meta charset=utf-8><link rel=stylesheet href="https://fonts.googleapis.com/css2?family={sysd['font'][2]}&family=Noto+Sans+KR:wght@400;600;700&display=swap">
<style>*{{box-sizing:border-box}}body{{margin:0;width:1120px;height:700px;overflow:hidden;display:flex}}button{{cursor:default}}</style>
<body>{panel(sysd, tk, 'light', mL)}{panel(sysd, tk, 'dark', mD)}</body>"""

def main():
    os.makedirs(OUT, exist_ok=True)
    rows = []; thumbs = []
    for s in SYSTEMS:
        tk, mL, mD = make(s)
        d = os.path.join(OUT, 'systems', s['id']); os.makedirs(d, exist_ok=True)
        json.dump(tk, open(os.path.join(d, 'tokens.json'), 'w'), ensure_ascii=False, indent=2)
        hp = os.path.join(TMP, s['id'] + '.html')
        open(hp, 'w').write(preview_html(s, tk, mL, mD))
        rows.append((s, checks(mL), checks(mD)))
    # render
    for s in SYSTEMS:
        hp = os.path.join(TMP, s['id'] + '.html')
        subprocess.run(['equipe', 'design', 'render', hp, '--widths', '1120'], capture_output=True)
        src = os.path.join(TMP, s['id'] + '-1120.png')
        if not os.path.exists(src): src = os.path.join(TMP, 't-1120.png')
        im = Image.open(src).convert('RGB'); sc = im.width/1120
        im = im.crop((0, 0, im.width, round(700*sc)))
        im.save(os.path.join(OUT, 'systems', s['id'], 'preview.png'))
    # contrast table
    lines = ['# 대비 AA 계산표 (light·dark)', '', 'WCAG 2.x 상대 휘도 대비. 기준: 본문 글자 4.5:1, UI 요소(primary·border-strong·ring) 3:1. `Klaxon`은 본문 7:1(AAA)로 맞춤.',
             '쌍 이름은 `글자색/바탕색`. **FAIL**이 있으면 굵게 표시.', '',
             '| 시스템 | 모드 | ' + ' | '.join(f'{a}/{b}' for a, b, t, r in rows[0][1]) + ' | 최소 | 판정 |', '|' + '---|'*(len(rows[0][1])+4)]
    allpass = True
    for s, cl, cd in rows:
        for mode, cs in (('light', cl), ('dark', cd)):
            cells = []; mn = 99; ok = True
            for a, b, t, r in cs:
                good = r >= t; ok &= good; mn = min(mn, r/t*4.5 if False else r)
                cells.append(f'{r:.2f}' if good else f'**{r:.2f} FAIL**')
            allpass &= ok
            lines.append(f"| {s['id']} | {mode} | " + ' | '.join(cells) + f" | {min(r for *_, r in cs):.2f} | {'AA 통과' if ok else '**실패**'} |")
    lines += ['', f'전체: {"모든 시스템 light·dark가 위 쌍에서 AA 통과" if allpass else "실패 항목 있음"}.']
    open(os.path.join(OUT, 'contrast.md'), 'w').write('\n'.join(lines) + '\n')
    # contact sheet 5 cols x 6 rows
    cw, ch, g, lab = 560, 350, 24, 34
    cols, nr = 5, 6
    sheet = Image.new('RGB', (cols*cw + (cols+1)*g, nr*(ch+lab) + (nr+1)*g + 90), '#f3f3f1')
    from PIL import ImageDraw, ImageFont
    dr = ImageDraw.Draw(sheet)
    try: fnt = ImageFont.truetype('/System/Library/Fonts/Supplemental/AppleGothic.ttf', 22); fb = ImageFont.truetype('/System/Library/Fonts/Supplemental/AppleGothic.ttf', 34)
    except Exception: fnt = fb = ImageFont.load_default()
    dr.text((g, 22), 'equipe design library — original 30 (light | dark)', fill='#111', font=fb)
    for i, s in enumerate(SYSTEMS):
        im = Image.open(os.path.join(OUT, 'systems', s['id'], 'preview.png')); im = im.resize((cw, round(cw*im.height/im.width)), Image.LANCZOS)
        x = g + (i % cols)*(cw+g); y = 90 + g + (i//cols)*(ch+lab+g)
        dr.text((x, y), f"{i+1:02d} {s['id']} · {s['ko']}", fill='#111', font=fnt)
        sheet.paste(im, (x, y+lab))
    sheet.save(os.path.join(OUT, 'contact-sheet.png'))
    print('allpass', allpass)

main()
