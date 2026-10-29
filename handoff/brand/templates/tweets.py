"""Tweet images (1600x900 design, 3200x1800 export) + OG (1200x630 + @2x).
Copy: tweets.json. Strategy + numbers: demo.json (one canonical demo). TICKER env var.
Review build (default): writes tweet-images/ and og/ with SAMPLE COPY / MOCK badges.
FINAL=1: writes final/tweet-images/ and final/og/ with no badges (disclaimers stay)."""
import json,os,pathlib
from common import BASE, DEMO, FINAL, graph3_js, MKT_CSS
from build import M, SW_, MW
from shoot import shoot
R=pathlib.Path('/workspace/brand/quiver'); T=R/'templates'; H=T/'_html'
OUT=R/'final' if FINAL else R
TICKER=os.environ.get('TICKER','$QUIVR')
D=DEMO; B=D['backtest']; fmt=lambda s:s.format(**D,**B)
css=(T/'graph.css').read_text(); js=(T/'graph.js').read_text()
def mk(h):  # v4: header mark is <=48px tall, so it uses the simplified capsule
    h=min(h,44); return f'<svg viewBox="0 0 {SW_:.3f} 100" height="{h}" width="{SW_*h/100:.2f}" style="display:block">{M(simple=True,inner=True)}</svg>'
def GRAPH(scale,t=1150,**kw):
    spec,GW,GH=graph3_js(**kw)
    return f'''<div id=g class=mkt style="transform:scale({scale});transform-origin:0 0"></div><script>{js}
QGraph(document.getElementById('g'),{{w:{GW},h:{GH},period:6000,{spec}}}).render({t});</script>''',GW,GH
def page(W,H_,inner):
    return f'''<!doctype html><meta charset=utf-8><style>{BASE}{css}{MKT_CSS}
body{{width:{W}px;height:{H_}px;overflow:hidden;position:relative}}
.amb{{position:absolute;inset:0;background:radial-gradient(900px 600px at 80% 60%,rgba(255,181,71,.05),transparent 70%)}}
.top{{position:absolute;left:96px;right:96px;top:72px;display:flex;justify-content:space-between;align-items:center}}
.tk{{font:500 18px "Geist Mono";letter-spacing:.1em;color:var(--text3)}} .tk b{{color:var(--amber);font-weight:500}}
.sample{{font:500 16px "Geist Mono";letter-spacing:.12em;color:var(--text3);border:1px solid var(--line2);border-radius:6px;padding:7px 11px}}
.lab{{font:500 18px/1 "Geist Mono";letter-spacing:.12em;text-transform:uppercase;color:var(--text3)}}
h1{{font:400 104px/.98 "Instrument Serif";letter-spacing:-.025em;color:var(--text)}} h1 em{{color:var(--cream)}}
.body{{font:400 26px/1.45 Geist;color:var(--text2)}}
.foot{{position:absolute;left:96px;bottom:72px;font:400 18px "Geist Mono";color:var(--text3);letter-spacing:.04em}} .foot b{{color:var(--text2);font-weight:400}}
</style><body><div class=amb></div>{inner}'''
def top(): return f'<div class=top><div style="display:flex;gap:18px;align-items:center">{mk(64)}<span class=tk>QUIVER <b>{TICKER}</b></span></div>'+('' if FINAL else '<span class=sample>SAMPLE COPY</span>')+'</div>'
VENUE=f'<b>Built for {D["venue"]}</b>'
data=json.load(open(T/'tweets.json')); jobs=[]
for t in data['tweets']:
    if t['layout']=='announce':
        inner=top()+f'''<div style="position:absolute;left:96px;top:230px;width:1200px"><div class=lab>{t['label']}</div><h1 style="margin-top:30px;font-size:150px">{t['title']}</h1><p class=body style="margin-top:36px;max-width:900px">{t['body']}</p></div><div class=foot>{VENUE}</div>'''
    elif t['layout']=='feature':
        g,GW,GH=GRAPH(1.42,nw=210,gap=44,step=62)
        inner=top()+f'''<div style="position:absolute;left:96px;top:210px;width:1400px"><div class=lab>{fmt(t['label'])}</div><h1 style="margin-top:26px;font-size:100px">{t['title']}</h1></div>
<div style="position:absolute;left:{1600-96-int(GW*1.42)}px;top:{int(560-GH*1.42/2)}px">{g}</div>
<p class=body style="position:absolute;left:96px;top:600px;width:330px;font-size:24px">{fmt(t['body'])}</p><div class=foot>{VENUE} · paper trading · {D['trigger']['sub']}{'' if FINAL else ' · // MOCK'}</div>'''
    else:
        inner=top()+f'''<div style="position:absolute;left:96px;top:220px;width:1150px"><div class=lab>{fmt(t['label'])}</div><h1 style="margin-top:30px;font-size:132px;line-height:1">{t['quote']}</h1></div>
<div style="position:absolute;left:96px;top:620px;display:flex;gap:44px;align-items:flex-end;border-top:1px solid var(--line2);padding-top:28px;width:1408px">
<div><div class=lab style="font-size:16px">{fmt(t['statlabel'])}</div><div class=mono style="font-size:64px;line-height:1;letter-spacing:-.04em;margin-top:14px;color:var(--amber)">{B['return']}</div></div>
<div class=mono style="font-size:20px;color:var(--text2);padding-bottom:6px">max drawdown {B['maxdd']} · {B['trades']} trades · {B['winrate']} win rate</div></div>
<div style="position:absolute;left:96px;top:{620+28+30+64+22}px;font:400 18px/1.4 Geist;color:var(--text3)">{D['disclaimer']}{'' if FINAL else ' <span class=mono style="color:var(--text3)">// MOCK</span>'}</div><div class=foot style="left:auto;right:96px">{VENUE}</div>'''
    p=H/f"tweet-{t['id']}{'-final' if FINAL else ''}.html"; p.write_text(page(1600,900,inner)); jobs.append((p,1600,900,2,OUT/f"tweet-images/tweet-{t['id']}-3200x1800.png",False))
# OG
g,GW,GH=GRAPH(0.8,nw=200,gap=36,step=52)
inner=f'''<div style="position:absolute;left:72px;top:60px;display:flex;gap:14px;align-items:center">{mk(56)}<span class=tk>QUIVER <b>{TICKER}</b></span></div>{'' if FINAL else '<span class=sample style="position:absolute;right:72px;top:72px;font-size:13px">SAMPLE COPY</span>'}
<div style="position:absolute;left:72px;top:190px;width:520px"><h1 style="font-size:80px">Every strategy<br>is an <em>arrow.</em></h1><p class=body style="font-size:22px;margin-top:24px">The AI strategy builder for {D['venue']}. Plain English in, live graph out.</p></div>
<div style="position:absolute;left:{1200-76-int(GW*0.8)}px;top:{int(330-GH*0.8/2)}px">{g}</div><div class=foot style="left:72px;bottom:54px;font-size:16px">{VENUE}</div>'''
p=H/f"og{'-final' if FINAL else ''}.html"; p.write_text(page(1200,630,inner))
jobs+=[(p,1200,630,1,OUT/'og/og-1200x630.png',False),(p,1200,630,2,OUT/'og/og-1200x630@2x.png',False)]
shoot(jobs); print(len(jobs))
