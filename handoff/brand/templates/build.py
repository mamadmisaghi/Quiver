#!/usr/bin/env python3
"""Quiver brand kit builder. Usage: TICKER='$QUIVR' python3 build.py   (ticker defaults to $QUIVR)"""
import os, json, pathlib, math
from geo import *
import qmark
from qmark import dims
OPT=os.environ.get('MARK','v4')  # v4 default; v3 options A|B|C kept but unused
MW,MH=dims(OPT); SW_,SH_=dims(OPT,True)
M=lambda v='color',simple=False,inner=False,tile=None: qmark.mark_svg(OPT,v,simple,inner,tile)
from common import BASE, TOK
from shoot import shoot
from PIL import Image
TICKER=os.environ.get('TICKER','$QUIVR')
R=pathlib.Path('/workspace/brand/quiver'); T=R/'templates'; H=T/'_html'; H.mkdir(exist_ok=True)
def w(p,s): p=R/p; p.parent.mkdir(parents=True,exist_ok=True); p.write_text(s); return p
jobs=[]
def png_of_svg(svg, vbw, vbh, sizes, stem):
    for s in sizes:
        k=s/max(vbw,vbh); jobs.append((svg, round(vbw*k), round(vbh*k), 1, R/f'{stem}-{s}.png', True))
# 1 marks (v3: open quiver, fletched arrows fanned, one amber)
for v,name in [('color','quiver-mark'),('mono','quiver-mark-cream'),('ink','quiver-mark-ink')]:
    p=w(f'mark/{name}.svg',M(v)); png_of_svg(p,MW,MH,[2048,4096],f'mark/{name}')
for v,name in [('color','quiver-mark-small'),('mono','quiver-mark-small-cream'),('ink','quiver-mark-small-ink')]:
    p=w(f'mark/{name}.svg',M(v,True)); png_of_svg(p,SW_,SH_,[2048,4096],f'mark/{name}')
for old in ['quiver-mark-bold']:
    for x in (R/'mark').glob(old+'*'): x.unlink()
w('mark/motion-ready/quiver-mark-layers.svg',M().replace('<path','<path class="part"'))
# 2 wordmark + lockups (outlined Instrument Serif)
WS=200; d,ww,asc,desc,cap=text_path('Quiver',WS,track=-0.012)
# glyph bbox (Q tail descends) -> measure via fontTools bounds
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont
def bounds(dpath):
    import re
    nums=[float(x) for x in re.findall(r'-?\d+\.?\d*',dpath)]
    xs=nums[0::2]; ys=nums[1::2]; return min(xs),min(ys),max(xs),max(ys)
import geo; bx0,by0,bx1,by1=geo.LAST_BOUNDS
def wm_svg(color=TEXT):
    pad=0; W_=bx1-bx0; H_=by1-by0
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{f(bx0)} {f(by0)} {f(W_)} {f(H_)}" width="{f(W_)}" height="{f(H_)}"><title>Quiver</title><path d="{d}" fill="{color}"/></svg>\n',W_,H_
s,W_,H_=wm_svg(); p=w('lockup/quiver-wordmark.svg',s); png_of_svg(p,W_,H_,[2048,4096],'lockup/quiver-wordmark')
s2,_,_=wm_svg(CREAM); p=w('lockup/quiver-wordmark-cream.svg',s2); png_of_svg(p,W_,H_,[2048,4096],'lockup/quiver-wordmark-cream')
# horizontal: mark height = 1.3 * cap height, mark vertically centred on cap height
def horiz(mono=False,simple=False):
    ink=mono=='ink'
    mh=cap*(1.06 if OPT=='v4' else (1.45 if simple else 1.62)); k=mh/100; mw=(SW_ if simple else MW)*k; gap=cap*0.42
    mx=0; my=-cap/2-mh/2+cap*0.04  # baseline y=0, cap centre at -cap/2
    tx=mw+gap-bx0
    x0=0; y0=min(my,by0); x1=tx+bx1; y1=max(my+mh,by1)
    inner=M('ink' if ink else 'mono' if mono else 'color',simple,inner=True)
    col=BG if ink else CREAM if mono else TEXT
    W_=x1-x0; H_=y1-y0
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{f(x0)} {f(y0)} {f(W_)} {f(H_)}" width="{f(W_)}" height="{f(H_)}"><title>Quiver</title><g id="mark" transform="translate({f(mx)} {f(my)}) scale({k:.5f})">{inner}</g><path id="wordmark" transform="translate({f(tx)} 0)" d="{d}" fill="{col}"/></svg>\n',W_,H_
def stacked(mono=False):
    ink=mono=='ink'
    ww_=bx1-bx0; mh=((bx1-bx0)*0.62/1.875 if OPT=='v4' else cap*2.6); k=mh/100; mw=MW*k; gap=cap*0.5
    mx=(ww_-mw)/2+bx0; my=by0-gap-mh
    inner=M('ink' if ink else 'mono' if mono else 'color',inner=True); col=BG if ink else CREAM if mono else TEXT
    x0=bx0; y0=my; W_=ww_; H_=by1-my
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{f(x0)} {f(y0)} {f(W_)} {f(H_)}" width="{f(W_)}" height="{f(H_)}"><title>Quiver</title><g id="mark" transform="translate({f(mx)} {f(my)}) scale({k:.5f})">{inner}</g><path id="wordmark" d="{d}" fill="{col}"/></svg>\n',W_,H_
for mono,suf in [(False,''),(True,'-cream'),('ink','-ink-on-light')]:
    s,W_,H_=horiz(mono,True); p=w(f'lockup/quiver-lockup-horizontal-small{suf}.svg',s); png_of_svg(p,W_,H_,[1024],f'lockup/quiver-lockup-horizontal-small{suf}')
for fn,nm in [(horiz,'horizontal'),(stacked,'stacked')]:
    for mono,suf in [(False,''),(True,'-cream'),('ink','-ink-on-light')]:
        s,W_,H_=fn(mono); p=w(f'lockup/quiver-lockup-{nm}{suf}.svg',s); png_of_svg(p,W_,H_,[2048,4096],f'lockup/quiver-lockup-{nm}{suf}')
# 3 app icon + favicons
def tile_full(size_vb=1024, markh=0.70, rx=0, simple=False):
    w_,h_=(SW_,SH_) if simple else (MW,MH); k=size_vb*markh/(w_ if OPT=='v4' else 100); mw=w_*k; mh=h_*k
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size_vb} {size_vb}" width="{size_vb}" height="{size_vb}"><title>Quiver</title><rect width="{size_vb}" height="{size_vb}" rx="{rx}" fill="{BG}"/><g transform="translate({f((size_vb-mw)/2)} {f((size_vb-mh)/2)}) scale({k:.5f})">{M(simple=simple,inner=True)}</g></svg>\n'
p=w('icon/app-icon.svg',tile_full()); jobs.append((p,1024,1024,1,R/'icon/app-icon-1024.png',False))
p=w('icon/app-icon-rounded.svg',tile_full(rx=228)); jobs.append((p,1024,1024,1,R/'icon/app-icon-rounded-1024.png',True))
fav=w('favicon/favicon.svg',M(simple=True,tile='#17171A'))
for s in [16,32,48]: jobs.append((fav,s,s,1,R/f'favicon/favicon-{s}.png',True))
for s,nm in [(180,'apple-touch-icon.png'),(192,'icon-192.png'),(512,'icon-512.png')]:
    jobs.append((R/'icon/app-icon.svg',s,s,1,R/f'favicon/{nm}',False))
# 4 token logo
p=w('token/token-logo.svg',tile_full(1000,0.80 if OPT=='v4' else 0.62,simple=True)); jobs.append((p,1000,1000,1,R/'token/token-logo-1000.png',False))
# 5 avatar (circle-safe: capsule width 62% keeps every point inside the inscribed circle)
p=w('social/avatar.svg',tile_full(1000,0.78 if OPT=='v4' else 0.60,simple=True))
for s in [400,1000]: jobs.append((p,s,s,1,R/f'social/x-avatar-{s}.png',False))
pt=w('social/avatar-transparent.svg',tile_full(1000,0.78 if OPT=='v4' else 0.60,simple=True).replace(f'<rect width="1000" height="1000" rx="0" fill="{BG}"/>',''))
jobs.append((pt,1000,1000,1,R/'social/x-avatar-transparent-1000.png',True))
# banner (HTML)
GRAPHCSS=(T/'graph.css').read_text(); GRAPHJS=(T/'graph.js').read_text()
mark_inline=M()
from common import graph3_js, MKT_CSS, DEMO
def banner_html(guides=False):
    g='''<div style="position:absolute;left:24px;top:330px;width:180px;height:180px;border-radius:50%;outline:2px dashed #f0f;"></div><div style="position:absolute;left:0;right:0;top:60px;bottom:60px;outline:2px dashed #0ff"></div><div style="position:absolute;left:0;top:0;bottom:0;width:250px;outline:2px dashed #ff0"></div>''' if guides else ''
    spec,GW,GH=graph3_js(nw=200,gap=40,step=52)
    sc=1.0
    return f'''<!doctype html><html><head><meta charset=utf-8><style>{BASE}{GRAPHCSS}{MKT_CSS}
body{{width:1500px;height:500px;overflow:hidden;position:relative}}
.hair{{position:absolute;inset:0;background:radial-gradient(900px 420px at 78% 50%,rgba(255,181,71,.055),transparent 70%)}}
.copy{{position:absolute;left:290px;top:110px;width:480px}}
.lab{{font:500 15px/1 "Geist Mono";letter-spacing:.12em;color:var(--text3);text-transform:uppercase;display:flex;gap:14px;align-items:center}}
.lab b{{color:var(--amber);font-weight:500}}
h1{{font:400 70px/1 "Instrument Serif";letter-spacing:-.02em;margin-top:22px;color:var(--text)}}
h1 em{{color:var(--cream)}}
p.s{{margin-top:20px;font:400 19px/1.45 Geist;color:var(--text2);letter-spacing:-.005em}}
#g{{position:absolute;left:{1500-50-int(GW*sc)}px;top:{int(250-GH*sc/2)}px;transform:scale({sc});transform-origin:0 0}}
</style></head><body><div class="hair"></div>
<div class=copy><div class=lab><span>Quiver</span><b>{TICKER}</b><span>· {DEMO['venue']}</span></div>
<h1>Every strategy<br>is an <em>arrow.</em></h1>
<p class=s>Describe a trade in plain English. Quiver turns it into a live graph you can paper trade, backtest and run.</p></div>
<div id=g class=mkt></div>{g}
<script>{GRAPHJS}
const G=QGraph(document.getElementById('g'),{{w:{GW},h:{GH},period:6000,{spec}}});
G.render(1150);</script></body></html>'''
b=w('templates/_html/banner.html',banner_html()); bq=w('templates/_html/banner-guides.html',banner_html(True))
jobs+= [(b,1500,500,1,R/'social/x-banner-1500x500.png',False),(b,1500,500,2,R/'social/x-banner-3000x1000.png',False),(bq,1500,500,1,R/'qa/x-banner-safezones.png',False)]
json.dump({'ticker':TICKER},open(R/'templates/_html/vars.json','w'))
if __name__=='__main__':
    shoot(jobs)
    ico=Image.open(R/'favicon/favicon-48.png'); ico.save(R/'favicon/favicon.ico',sizes=[(16,16),(32,32),(48,48)],append_images=[Image.open(R/f'favicon/favicon-{s}.png') for s in (16,32)])
    print('rendered',len(jobs))
