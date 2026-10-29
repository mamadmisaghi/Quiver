import pathlib
from common import BASE, TOK
from shoot import shoot
import os
TICKER=os.environ.get('TICKER','$QUIVR')
R=pathlib.Path('/workspace/brand/quiver'); u=lambda p:(R/p).as_uri()
# type specimen + css
tcss='''/* Quiver type scale — Instrument Serif (display) · Geist (UI) · Geist Mono (data/labels) */
@import url("https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap");
:root{--q-font-display:"Instrument Serif",Georgia,serif;--q-font-sans:Geist,ui-sans-serif,system-ui,sans-serif;--q-font-mono:"Geist Mono",ui-monospace,monospace}
.q-display-xl{font:400 96px/.95 var(--q-font-display);letter-spacing:-.025em}
.q-display{font:400 72px/1 var(--q-font-display);letter-spacing:-.02em}
.q-h1{font:400 48px/1.05 var(--q-font-display);letter-spacing:-.015em}
.q-h2{font:400 32px/1.15 var(--q-font-display);letter-spacing:-.01em}
.q-h3{font:500 20px/1.3 var(--q-font-sans);letter-spacing:-.01em}
.q-body-lg{font:400 18px/1.5 var(--q-font-sans)}
.q-body{font:400 15px/1.55 var(--q-font-sans)}
.q-small{font:400 13px/1.45 var(--q-font-sans)}
.q-label{font:500 12px/1 var(--q-font-mono);letter-spacing:.08em;text-transform:uppercase}
.q-data{font:400 20px/1 var(--q-font-mono);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.q-display em,.q-display-xl em,.q-h1 em,.q-h2 em{font-style:italic} /* one italic word per heading, in cream */
'''
(R/'type').mkdir(exist_ok=True); (R/'type/type.css').write_text(tcss)
rows=[('Display XL · Instrument Serif 96/0.95 −2.5%','q-display-xl','Every strategy is an <em>arrow.</em>'),
('Display · 72/1 −2%','q-display','Type an idea. Watch it <em>trade.</em>'),
('H1 · 48/1.05','q-h1','Signals, triggers, <em>actions.</em>'),('H2 · 32/1.15','q-h2','Paper trade before you go live.'),
('H3 · Geist 500 20/1.3','q-h3','Backtest any strategy over 90 days'),('Body L · Geist 18/1.5','q-body-lg','Describe a trade in plain English. Quiver turns it into a live graph you can test and run.'),
('Body · Geist 15/1.55','q-body','Built for Robinhood Chain. Connects to Solana, Hyperliquid and Polymarket.'),
('Label · Geist Mono 500 12 +8%','q-label','Signal · Trigger · Action'),('Data · Geist Mono tabular 20','q-data','+12.4%  −4.1%  $500  38 trades')]
body=''.join(f'<div class=r><div class=m>{a}</div><div class="{c}" style="color:var(--text)">{t}</div></div>' for a,c,t in rows)
html=f'''<!doctype html><meta charset=utf-8><style>{BASE}{tcss.split("*/",1)[1].replace('@import','/*').replace('swap");','*/')}
body{{width:1600px;height:1100px;padding:72px 88px}} .q-display-xl em,.q-display em,.q-h1 em{{color:var(--cream)}}
.top{{display:flex;justify-content:space-between;font:500 12px "Geist Mono";letter-spacing:.12em;color:var(--text3);text-transform:uppercase;border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:12px}}
.r{{display:grid;grid-template-columns:300px 1fr;align-items:baseline;padding:16px 0;border-bottom:1px solid var(--line)}} .m{{font:400 12px "Geist Mono";color:var(--text3)}}
.q-label{{color:var(--text2)!important}}</style><body><div class=top><span>Quiver · Type scale</span><span>Instrument Serif · Geist · Geist Mono</span></div>{body}</body>'''
(R/'templates/_html/type.html').write_text(html)
# small-size test (v3): full mark only >=64px; simplified mark <=48px; favicon tile on light + dark tab bars; circle crops
def strip(src,label,sizes=(16,24,32,48,64,96),dim='height',cls=''):
    return f'<div class="row {cls}"><span>{label}</span>'+''.join(f'<div class=c><img src="{u(src)}" style="{dim}:{s}px"><small>{s}</small></div>' for s in sizes)+'</div>'
def tab(bg,fg,label):
    return f'<div class=row><span>{label}</span><div style="background:{bg};padding:8px 14px;border-radius:8px 8px 0 0;display:flex;gap:10px;align-items:center;font:13px Geist;color:{fg}"><img src="{u('favicon/favicon-16.png')}" style="width:16px;height:16px">Quiver · strategy builder</div><div style="background:{bg};padding:8px;border-radius:8px"><img src="{u('favicon/favicon-32.png')}" style="width:32px"></div><div style="background:{bg};padding:8px;border-radius:8px"><img src="{u('favicon/favicon-48.png')}" style="width:48px"></div></div>'
qa=f'''<!doctype html><meta charset=utf-8><style>{BASE}body{{width:1400px;padding:40px;}}.row{{display:flex;gap:28px;align-items:center;padding:16px 0;border-bottom:1px solid var(--line)}}.row>span{{width:300px;font:13px "Geist Mono";color:var(--text3)}}.c{{display:flex;flex-direction:column;align-items:center;gap:6px}}small{{font:11px "Geist Mono";color:var(--text3)}}
.light{{background:#F4F2EC;padding:0 16px}} .circ img{{border-radius:50%}} h3{{font:500 14px "Geist Mono";letter-spacing:.1em;color:var(--text2);text-transform:uppercase;margin:18px 0 4px}}</style><body>
<h3>Full mark · use at 64px and up</h3>
{strip('mark/quiver-mark.svg','full mark · colour',(64,96,128))}
<h3>Simplified mark · 48px and under</h3>
{strip('mark/quiver-mark-small.svg','simplified · colour',(16,24,32,48))}
{strip('mark/quiver-mark-small-cream.svg','simplified · cream',(16,24,32,48))}
<h3>Favicon (backing tile #17171A) on browser tab bars</h3>
{tab('#DEE1E6','#202124','light tab bar')}{tab('#35363A','#E8EAED','dark tab bar')}{tab('#FFFFFF','#202124','white')}
<h3>Circle crops (simplified mark)</h3>
<div class="circ">{strip('token/token-logo-1000.png','token · circle crop',(24,32,48,64,128),'width')}</div>
<div class="circ">{strip('social/x-avatar-400.png','avatar · circle crop',(24,32,48,64,128),'width')}</div>
<h3>On light</h3>
<div class=light>{strip('mark/quiver-mark-ink.svg','ink full mark',(64,96))}</div>
<div class=light>{strip('mark/quiver-mark-small-ink.svg','ink simplified',(16,24,32,48))}</div>
<div class=light>{strip('lockup/quiver-lockup-horizontal-small-ink-on-light.svg','ink lockup small (≤48px mark)',(24,32),'height')}</div>
<div class=light>{strip('lockup/quiver-lockup-horizontal-ink-on-light.svg','ink lockup (≥64px mark)',(64,96),'height')}</div>
</body>'''
(R/'templates/_html/qa-small.html').write_text(qa)
# brand sheet
sw=''.join(f'<div class=sw><i style="background:{v}"></i><b>{k}</b><span>{v}</span></div>' for k,v in TOK.items() if k in('bg','bg2','line','text','text2','text3','cream','amber','amberPress','up','down'))
sheet=f'''<!doctype html><meta charset=utf-8><style>{BASE}
body{{width:2400px;height:2150px;padding:64px;display:grid;grid-template-columns:1.25fr 1fr;grid-template-rows:auto 1fr 1fr 520px;gap:28px}} .row4{{grid-column:1/3;display:grid;grid-template-columns:repeat(4,1fr);gap:28px}}
.hd{{grid-column:1/3;display:flex;justify-content:space-between;align-items:end;border-bottom:1px solid var(--line);padding-bottom:24px}}
.hd img{{height:64px}} .hd span{{font:500 14px "Geist Mono";letter-spacing:.12em;color:var(--text3);text-transform:uppercase}}
.cell{{border:1px solid var(--line);border-radius:20px;overflow:hidden;position:relative;background:#0E0E10}}
.cell>small{{position:absolute;left:18px;top:16px;font:500 12px "Geist Mono";letter-spacing:.1em;color:var(--text3);text-transform:uppercase;z-index:2}}
.cell img.fill{{width:100%;height:100%;object-fit:cover;display:block}}
.marks{{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;align-items:center;justify-items:center;height:100%;padding:40px}}
.marks img{{width:85%}}
.sws{{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:48px 20px 16px}} .sw{{display:grid;grid-template-columns:44px 1fr;grid-template-rows:auto auto;column-gap:12px;font:12px "Geist Mono";color:var(--text3)}} .sw i{{grid-row:1/3;width:44px;height:44px;border-radius:10px;border:1px solid var(--line2)}} .sw b{{color:var(--text);font-weight:500}}
.pair{{display:grid;grid-template-columns:1fr 1fr;gap:28px}}
</style><body>
<div class=hd><img src="{u('lockup/quiver-lockup-horizontal.svg')}"><span>Brand sheet · style lock v4 · ticker {TICKER}</span></div>
<div class=cell><small>Hero mock</small><img class=fill src="{u('hero/hero-2880x1800.png')}" style="object-fit:contain"></div>
<div style="display:grid;grid-template-rows:1fr 1fr;gap:28px"><div class=cell><small>Marks</small><div class=marks><img src="{u('mark/quiver-mark.svg')}" style="width:200px;height:auto"><img src="{u('mark/quiver-mark-cream.svg')}" style="width:130px;height:auto"><img src="{u('mark/quiver-mark-small.svg')}" style="width:80px;height:auto"><img src="{u('icon/app-icon-rounded-1024.png')}" style="width:60%;border:1px solid #26262B;border-radius:22%"></div></div>
<div class=pair><div class=cell><small>Palette</small><div class=sws>{sw}</div></div><div class=cell style="display:grid;place-items:center"><small>Token · 48px circle</small><div style="display:flex;gap:28px;align-items:center"><img src="{u('token/token-logo-1000.png')}" style="width:240px;border-radius:50%"><img src="{u('token/token-logo-1000.png')}" style="width:48px;border-radius:50%"></div></div></div></div>
<div class=cell><small>X banner</small><img class=fill src="{u('social/x-banner-3000x1000.png')}" style="object-fit:contain"></div>
<div class=cell><small>Type</small><img class=fill src="{u('type/type-specimen.png')}" style="object-position:top"></div>
<div class=row4><div class=cell><small>Tweet · announcement</small><img class=fill src="{u('tweet-images/tweet-01-announcement-3200x1800.png')}" style="object-fit:contain"></div><div class=cell><small>Tweet · strategy card</small><img class=fill src="{u('tweet-images/tweet-02-strategy-card-3200x1800.png')}" style="object-fit:contain"></div><div class=cell><small>Tweet · stat</small><img class=fill src="{u('tweet-images/tweet-03-stat-3200x1800.png')}" style="object-fit:contain"></div><div class=cell><small>OG 1200×630</small><img class=fill src="{u('og/og-1200x630@2x.png')}" style="object-fit:contain"></div></div>
</body>'''
(R/'templates/_html/sheet.html').write_text(sheet)
shoot([(R/'templates/_html/type.html',1600,1100,2,R/'type/type-specimen.png',False),(R/'templates/_html/qa-small.html',1400,1640,2,R/'qa/small-size-test.png',False)])
shoot([(R/'templates/_html/sheet.html',2400,2150,1,R/'brand-sheet.png',False)])
