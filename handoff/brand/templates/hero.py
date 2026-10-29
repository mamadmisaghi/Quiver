import pathlib,os,json,subprocess,shutil
from common import BASE, DEMO, FINAL
import json
D=DEMO; B=D['backtest']; OUT=(pathlib.Path('/workspace/brand/quiver/final/hero') if FINAL else pathlib.Path('/workspace/brand/quiver/hero'))
from build import d as WM, bx0,by0,bx1,by1, TICKER, M, MW, MH
R=pathlib.Path('/workspace/brand/quiver'); T=R/'templates'
css=(T/'graph.css').read_text(); js=(T/'graph.js').read_text()
wm=f'<svg viewBox="{bx0} {by0} {bx1-bx0} {by1-by0}" height="22" style="display:block"><path d="{WM}" fill="#F5F3EF"/></svg>'
from build import SW_
mk=f'<svg viewBox="0 0 {SW_:.3f} 100" height="26" width="{SW_*0.26:.2f}" style="display:block">{M(simple=True,inner=True)}</svg>'
html=f'''<!doctype html><html lang=en><head><meta charset=utf-8><title>Quiver — hero mock</title><style>{BASE}{css}
body{{width:1440px;height:900px;overflow:hidden;position:relative}}
.amb{{position:absolute;inset:0;background:radial-gradient(800px 520px at 74% 52%,rgba(255,181,71,.05),transparent 70%),radial-gradient(1200px 600px at 20% -10%,rgba(237,230,218,.035),transparent 60%)}}
header{{position:absolute;left:64px;right:64px;top:28px;height:44px;display:flex;align-items:center;justify-content:space-between}}
.brand{{display:flex;gap:11px;align-items:center}}
nav{{display:flex;gap:30px;font:400 14px Geist;color:var(--text2)}}
.cta{{display:flex;gap:22px;align-items:center}}
.btn{{height:38px;padding:0 16px;border-radius:999px;font:500 14px/38px Geist;letter-spacing:-.005em}}
.btn.g{{border:1px solid var(--line2);color:var(--text)}} .btn.p{{background:var(--cream);color:#0A0A0B}}
.hl{{position:absolute;left:0;right:0;top:96px;height:1px;background:var(--line);opacity:.6}}
.left{{position:absolute;left:96px;top:188px;width:520px}}
.lab{{font:500 12px/1 "Geist Mono";letter-spacing:.12em;text-transform:uppercase;color:var(--text3);display:flex;gap:10px;align-items:center}}
.lab .dot{{width:6px;height:6px;border-radius:50%;background:var(--amber);opacity:calc(.5 + var(--blink,1)*.5)}}
h1{{font:400 84px/.98 "Instrument Serif";letter-spacing:-.025em;margin-top:26px}} h1 em{{color:var(--cream)}}
p.lede{{margin-top:24px;font:400 18px/1.55 Geist;color:var(--text2);max-width:470px}}
.prompt{{margin-top:36px;width:500px;border:1px solid var(--line2);border-radius:14px;background:#111113;padding:16px 16px 14px}}
.prompt .q{{font:400 15px/1.5 Geist;color:var(--text);min-height:45px}} .caret{{display:inline-block;width:1.5px;height:18px;background:var(--amber);vertical-align:-3px;margin-left:1px}}
.prompt .row{{display:flex;justify-content:space-between;align-items:center;margin-top:12px}}
.chips{{display:flex;gap:6px}} .chip{{font:500 11.5px/1 "Geist Mono";color:var(--text2);border:1px solid var(--line);border-radius:999px;padding:7px 10px}}
.send{{width:34px;height:34px;border-radius:10px;background:var(--amber);display:grid;place-items:center}}
.panel{{position:absolute;left:676px;top:160px;width:676px;height:600px;border:1px solid var(--line);border-radius:20px;background:rgba(17,17,19,.72);overflow:hidden}}
.ph{{height:52px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 20px;font:400 12.5px "Geist Mono";color:var(--text3)}}
.ph b{{color:var(--text);font-weight:500}} .demo{{border:1px solid var(--line2);border-radius:999px;padding:5px 9px;font-size:11px;color:var(--text2)}}
.state{{display:flex;gap:8px;align-items:center}} .live{{width:6px;height:6px;border-radius:50%;background:var(--text3)}}
.tlink{{font:500 13px 'Geist Mono';color:var(--text2);letter-spacing:.04em;text-decoration:underline;text-decoration-color:var(--line2);text-underline-offset:5px}}
.qn-k i{{background:var(--text3)!important}} .qn-trigger .qn-k i{{background:var(--cream)!important}}
.grid{{position:absolute;inset:52px 0 92px 0;background-image:radial-gradient(rgba(255,255,255,.045) 1px,transparent 1px);background-size:20px 20px}}
#g{{position:absolute;left:26px;top:76px}}
.stats{{position:absolute;left:0;right:0;bottom:0;height:92px;border-top:1px solid var(--line);display:grid;grid-template-columns:repeat(4,1fr)}}
.stats div{{padding:18px 20px;border-right:1px solid var(--line)}} .stats div:last-child{{border:0}}
.stats small{{display:block;font:500 11px/1 "Geist Mono";letter-spacing:.08em;text-transform:uppercase;color:var(--text3)}}
.stats span{{display:block;margin-top:12px;font:400 22px/1 "Geist Mono";letter-spacing:-.02em;color:var(--text)}} .stats .a{{color:var(--amber)}}
.chains{{position:absolute;left:96px;bottom:56px;font:400 12.5px "Geist Mono";color:var(--text3);letter-spacing:.04em;display:flex;gap:22px}} .chains b{{color:var(--text2);font-weight:400}}
.foot{{position:absolute;right:88px;bottom:56px;font:400 12px "Geist Mono";color:var(--text3)}}
</style></head><body><div class=amb></div>
<header><div class=brand>{mk}{wm}</div><nav><span>Strategies</span><span>Backtests</span><span>Skills</span><span>Docs</span></nav><div class=cta><a class=tlink>{TICKER}</a><span class="qbtn qbtn-p">Open app<svg viewBox="0 0 12 12"><path d="M2.5 9.5 L9 3 M4.5 3 H9 V7.5" stroke="currentColor" stroke-width="1.5" fill="none"/></svg></span></div></header><div class=hl></div>
<div class=left><div class=lab id=lab><span class=dot></span>AI strategy builder · Robinhood Chain</div>
<h1>Type an idea.<br>Watch it <em>trade.</em></h1>
<p class=lede>Describe a strategy in plain English. Quiver draws it as a live graph of signals, triggers and actions, then paper trades and backtests it before you go live.</p>
<div class=prompt><div class=q id=q></div><div class=row><div class=chips><span class=chip>Paper trade</span><span class=chip>Backtest 90d</span><span class=chip>+ Skill</span></div><div class=send title=Draft><svg width=16 height=16 viewBox="0 0 16 16"><path d="M3 13 L12 4 M6 4 H12 V10" stroke="#0A0A0B" stroke-width="1.8" fill="none" stroke-linecap="square"/></svg></div></div></div></div>
<div class=panel><div class=ph><span>strategy / <b>{D['slug']}</b></span><span class=state><span class=live></span>paper · running <span class=demo>Demo data</span></span></div><div class=grid></div><div id=g></div>
<div class=stats><div><small>Backtest 90d</small><span class=a id=s1>{B['return']}</span></div><div><small>Max drawdown</small><span>{B['maxdd']}</span></div><div><small>Trades</small><span id=s3>{B['trades']}</span></div><div><small>Win rate</small><span>{B['winrate']}</span></div></div></div>
<div class=chains><b>Built for Robinhood Chain</b><span>connects to {D['connects']}</span></div>
<div class=foot>{'' if FINAL else '// MOCK · '}{D['disclaimer']}</div>
<script>{js}
const P=6000;
const G=QGraph(document.getElementById('g'),{{w:624,h:400,period:P,nodes:[
 {{id:'s1',kind:'signal',label:{json.dumps(D['signal']['label'])},title:{json.dumps(D['signal']['title'])},val:'{D['signal']['val']}',x:0,y:132,w:196,live:p=>(28.9-0.6*Math.sin(p*2*Math.PI)).toFixed(1)}},
 {{id:'t',kind:'trigger',label:'Trigger',title:{json.dumps(D['trigger']['title'])},sub:{json.dumps(D['trigger']['sub'])},x:232,y:132,w:180}},
 {{id:'a1',kind:'action',label:'Action',title:{json.dumps(D['action']['title'])},sub:'paper · size ${D['size_usd']}',x:448,y:30,w:176}},
 {{id:'a2',kind:'action',label:'Action',title:{json.dumps(D['exit']['title'])},sub:{json.dumps(D['exit']['sub'])},x:448,y:236,w:176}}],
 edges:[{{from:'s1',to:'t',t0:200,t1:1600}},{{from:'t',to:'a1',t0:1900,t1:3200}},{{from:'t',to:'a2',t0:3900,t1:5300}}]}});
const Q={json.dumps(D['prompt'])};
const q=document.getElementById('q'),lab=document.getElementById('lab');
window.__seek=function(t){{G.render(t);const p=(t%P)/P;q.innerHTML=Q+'<span class=caret style="opacity:'+(Math.floor(t/530)%2?0:1)+'"></span>';lab.style.setProperty('--blink',(Math.sin(t/900)+1)/2);}};
if(!window.__manual){{const s=performance.now();(function f(){{__seek(performance.now()-s);requestAnimationFrame(f)}})();}}else __seek(0);
</script></body></html>'''
OUT.mkdir(parents=True,exist_ok=True); (OUT/'hero.html').write_text(html)
