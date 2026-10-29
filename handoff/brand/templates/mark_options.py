"""qa/mark-options-v3.png: 3 mark directions, each large + 96/64 full and 48/32/16 simplified + favicon tile on light/dark tab bars."""
import qmark, pathlib
from common import BASE
from shoot import shoot
R=pathlib.Path('/workspace/brand/quiver'); H=R/'templates/_html'
desc={'A':('Fletch fan','CHOSEN. The most literal quiver: arrows stored the way archers store them, fletching out, fanned from one pivot inside an open, leaning body with a rim and strap. No finance-arrow or battery read. The amber centre arrow is the one strategy you pick.'),
'B':('Broadheads','Heads out. Clean, but three up-pointing heads drift back toward the generic “growth arrow” the critique flagged, and it is close to the v2 read.'),
'C':('Drawn arrow','Story mark: two stored arrows, the amber one pulled head-first. A nice idea, but the up-right amber head is the finance cliché again, and it gets busy below 48px.')}
cells=''
for o in 'ABC':
    (H/f'opt{o}.svg').write_text(qmark.mark_svg(o)); (H/f'opt{o}s.svg').write_text(qmark.mark_svg(o,simple=True)); (H/f'opt{o}t.svg').write_text(qmark.mark_svg(o,simple=True,tile='#17171A'))
    n,dsc=desc[o]
    sm=''.join(f'<div class=s><img src="opt{o}{"" if sz>=64 else "s"}.svg" style="height:{sz}px"><small>{sz}{"" if sz>=64 else " simple"}</small></div>' for sz in (96,64,48,32,16))
    fav=''.join(f'<div class=s style="background:{bg};padding:8px 10px;border-radius:6px;flex-direction:row;gap:8px"><img src="opt{o}t.svg" style="height:16px"><img src="opt{o}t.svg" style="height:32px"></div>' for bg in ('#DEE1E6','#35363A'))
    cells+=f'''<div class="c{' pick' if o=='A' else ''}"><div class=h><b>Option {o} · {n}</b>{'<span class=tag>Chosen</span>' if o=='A' else ''}</div>
<div class=big><img src="opt{o}.svg"><img src="opt{o}s.svg" style="height:220px"></div><div class=cap><span>full mark</span><span>simplified ≤48px</span></div><div class=sizes>{sm}</div><div class=sizes><span class=lbl>favicon · light / dark tab</span>{fav}</div><p>{dsc}</p></div>'''
html=f'''<!doctype html><meta charset=utf-8><style>{BASE}
body{{width:2400px;height:1180px;padding:64px}} .t{{display:flex;justify-content:space-between;font:500 16px "Geist Mono";letter-spacing:.12em;text-transform:uppercase;color:var(--text3);border-bottom:1px solid var(--line);padding-bottom:22px}}
.g{{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin-top:32px}} .c{{border:1px solid var(--line);border-radius:20px;padding:28px;background:#0E0E10}} .c.pick{{border-color:rgba(255,181,71,.55)}}
.h{{display:flex;justify-content:space-between;align-items:center;font:500 22px Geist}} .tag{{font:500 14px "Geist Mono";color:var(--amber);letter-spacing:.1em;text-transform:uppercase}}
.big{{height:480px;display:flex;align-items:center;justify-content:center;gap:70px}} .big img{{height:400px}} .cap{{display:flex;justify-content:space-around;font:13px "Geist Mono";color:var(--text3);margin:-10px 0 14px}}
.sizes{{display:flex;gap:24px;align-items:flex-end;border-top:1px solid var(--line);padding:16px 0}} .s{{display:flex;flex-direction:column;align-items:center;gap:8px}} small,.lbl{{font:13px "Geist Mono";color:var(--text3)}} .lbl{{align-self:center;width:130px}}
p{{margin-top:6px;font:400 17px/1.5 Geist;color:var(--text2)}}</style><body>
<div class=t><span>Quiver · mark options v3</span><span>open quiver · fletched arrows · one amber</span></div><div class=g>{cells}</div></body>'''
(H/'mark-options.html').write_text(html)
shoot([(H/'mark-options.html',2400,1180,1,R/'qa/mark-options-v3.png',False)])
