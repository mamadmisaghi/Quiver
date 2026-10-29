"""qa/mark-v4.png: v2 capsule mark vs v4 (same capsule, real archery arrows)."""
import pathlib
from common import BASE
from shoot import shoot
R=pathlib.Path('/workspace/brand/quiver'); u=lambda p:(R/p).as_uri()
def col(t,full,small,token):
    sz=''.join(f'<div class=c><img src="{u(full if s>=64 else small)}" style="height:{s*64//120 if False else s*64/120:.1f}px;width:{s}px"><small>{s}px wide</small></div>' for s in (64,48,32,16))
    return f'''<div class=card><div class=lab>{t}</div><div class=big><img src="{u(full)}" style="width:640px"></div>
<div class=row>{sz}</div><div class=row><div class=c><img src="{u(token)}" class=circ style="width:200px"><small>token circle · 200</small></div><div class=c><img src="{u(token)}" class=circ style="width:48px"><small>48</small></div><div class=c><img src="{u(token)}" class=circ style="width:32px"><small>32</small></div></div></div>'''
h=f'''<!doctype html><meta charset=utf-8><style>{BASE}body{{width:1600px;padding:48px;display:flex;gap:40px}}
.card{{flex:1;border:1px solid var(--line2);border-radius:20px;padding:36px;background:var(--bg2)}}.lab{{font:500 15px "Geist Mono";letter-spacing:.12em;color:var(--text2);text-transform:uppercase}}
.big{{padding:40px 0 30px;display:flex;justify-content:center}}.row{{display:flex;gap:40px;align-items:flex-end;padding:22px 0;border-top:1px solid var(--line)}}
.c{{display:flex;flex-direction:column;align-items:center;gap:10px}}small{{font:12px "Geist Mono";color:var(--text3)}}.circ{{border-radius:50%;outline:1px solid #26262B}}</style><body>
{col('v2 · archived · generic arrows','_archive-v2/mark/quiver-mark.svg','_archive-v2/mark/quiver-mark-bold.svg','_archive-v2/token/token-logo-1000.png')}
{col('v4 · same capsule · real archery arrows','mark/quiver-mark.svg','mark/quiver-mark-small.svg','token/token-logo-1000.png')}</body>'''
p=R/'templates/_html/mark-v4.html'; p.write_text(h); shoot([(p,1600,1080,2,R/'qa/mark-v4.png',False)])
