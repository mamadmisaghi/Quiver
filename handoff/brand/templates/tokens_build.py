import json,pathlib
from common import TOK
R=pathlib.Path('/workspace/brand/quiver/tokens')
def lum(h):
    c=[int(h[i:i+2],16)/255 for i in (1,3,5)]; c=[x/12.92 if x<=.03928 else ((x+.055)/1.055)**2.4 for x in c]
    return .2126*c[0]+.7152*c[1]+.0722*c[2]
def cr(a,b): A,B=sorted([lum(a),lum(b)],reverse=True); return (A+.05)/(B+.05)
roles={'bg':'page background','bg1':'raised surface','bg2':'card / node','line':'hairline border','line2':'strong border / focus ring base',
 'text':'primary text','text2':'secondary text','text3':'tertiary text / mono labels (≥12px)','cream':'brand cream: mark, wordmark, values','amber':'signature accent: one per view, live arrows, primary CTA','amberPress':'accent pressed/hover','amberDim':'accent at rest (inactive edges, disabled)','up':'semantic positive (data only)','down':'semantic negative (data only)','statusLive':'status: live / running','statusPaper':'status: paper trading / simulated','statusError':'status: error / stopped','statusIdle':'status: idle / draft'}
tokens={'color':{k:{'value':v,'role':roles[k]} for k,v in TOK.items()},
 'font':{'display':'"Instrument Serif", Georgia, serif','sans':'Geist, ui-sans-serif, system-ui, sans-serif','mono':'"Geist Mono", ui-monospace, monospace'},
 'radius':{'xs':'4px','sm':'8px','md':'12px','lg':'16px','xl':'24px','pill':'999px'},
 'space':{str(i):f'{i*4}px' for i in [1,2,3,4,6,8,10,12,16,20,24]},
 'shadow':{'card':'0 1px 0 rgba(255,255,255,.03) inset, 0 10px 30px -12px rgba(0,0,0,.6)','focus':'0 0 0 2px #0A0A0B, 0 0 0 4px #FFB547'},
 'button':{'primary':{'radius':'8px','height':'38px','text':'#FFB547','fill':'rgba(255,181,71,.07)','border':'inset 0 0 0 1px rgba(255,181,71,.55)','detail':'nock notch on the left edge + up-right arrow glyph','hover':'fill rgba(255,181,71,.12), border #FFB547','pressed':'text #E0952A'},'secondary':{'radius':'8px','border':'#34343B','text':'#F5F3EF'},'never':'near-white or cream full pill (weft distance)'},
 'motion':{'ease':'cubic-bezier(.45,0,.55,1) /* power2.inOut */','fast':'160ms','base':'280ms','arrow':'1400ms'},
 'type':{'display-xl':'96/0.95 Instrument Serif -0.025em','display':'72/1 Instrument Serif -0.02em','h1':'48/1.05 Instrument Serif -0.015em','h2':'32/1.15 Instrument Serif -0.01em','body-lg':'18/1.5 Geist','body':'15/1.55 Geist','small':'13/1.45 Geist','label':'12/1 Geist Mono 0.08em uppercase','data':'20/1 Geist Mono tabular -0.02em'}}
pairs=[('text','bg'),('text2','bg'),('text3','bg'),('cream','bg'),('amber','bg'),('text3','bg2'),('text2','bg2'),('bg','amber'),('bg','cream'),('up','bg'),('down','bg'),('amberDim','bg'),('statusLive','bg'),('statusPaper','bg'),('statusError','bg'),('statusIdle','bg'),('amber','bg1')]
checks=[]
for a,b in pairs:
    r=cr(TOK[a],TOK[b]); checks.append({'fg':a,'bg':b,'ratio':round(r,2),'AA_text':r>=4.5,'AA_large':r>=3,'AAA':r>=7})
tokens['contrast']=checks
R.mkdir(exist_ok=True)
json.dump(tokens,open(R/'tokens.json','w'),indent=2,ensure_ascii=False)
css=':root{\n'+''.join(f'  --q-{k}: {v};\n' for k,v in TOK.items())+''.join(f'  --q-font-{k}: {v};\n' for k,v in tokens['font'].items())+''.join(f'  --q-radius-{k}: {v};\n' for k,v in tokens['radius'].items())+f"  --q-shadow-card: {tokens['shadow']['card']};\n  --q-shadow-focus: {tokens['shadow']['focus']};\n  --q-ease: cubic-bezier(.45,0,.55,1);\n"+'}\n'
css+='''html{background:var(--q-bg);color:var(--q-text);font-family:var(--q-font-sans)}
::selection{background:var(--q-amber);color:var(--q-bg)}
:focus-visible{outline:none;box-shadow:var(--q-shadow-focus)}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
'''
open(R/'tokens.css','w').write(css)
tw='// tailwind.config.ts — theme.extend\nexport const quiver = {\n  colors: { q: {\n'+''.join(f"    {k}: '{v}',\n" for k,v in TOK.items())+'''  } },
  fontFamily: { display: ['"Instrument Serif"','Georgia','serif'], sans: ['Geist','ui-sans-serif','system-ui'], mono: ['"Geist Mono"','ui-monospace'] },
  borderRadius: { xs:'4px', sm:'8px', md:'12px', lg:'16px', xl:'24px' },
  boxShadow: { card: '0 1px 0 rgba(255,255,255,.03) inset, 0 10px 30px -12px rgba(0,0,0,.6)', focus: '0 0 0 2px #0A0A0B, 0 0 0 4px #FFB547' },
  transitionTimingFunction: { q: 'cubic-bezier(.45,0,.55,1)' },
};
'''
open(R/'tailwind.quiver.ts','w').write(tw)
md='# Contrast checks (WCAG 2.x)\n\n| fg | bg | ratio | AA text | AA large |\n|---|---|---|---|---|\n'+''.join(f"| {c['fg']} {TOK[c['fg']]} | {c['bg']} {TOK[c['bg']]} | {c['ratio']} | {'✓' if c['AA_text'] else '✗'} | {'✓' if c['AA_large'] else '✗'} |\n" for c in checks)
import colorsys
def hue(x): return colorsys.rgb_to_hls(*[int(x[i:i+2],16)/255 for i in (1,3,5)])[0]*360
md+='\n## Status hues vs weft amber #f0a83a (hue %d°)\nAmber #FFB547 is accent-only (CTA, light-arrows, one highlight per view) and never means a status.\n\n| status | hex | hue | Δhue from #f0a83a |\n|---|---|---|---|\n'%round(hue('#f0a83a'))
for k in ['statusLive','statusPaper','statusError','statusIdle']:
    dh=abs(hue(TOK[k])-hue('#f0a83a')); dh=min(dh,360-dh); md+=f"| {k} | {TOK[k]} | {round(hue(TOK[k]))}° | {round(dh)}°{' (neutral grey)' if k=='statusIdle' else ''} |\n"
md+='\namberDim is decorative only (inactive edges), never for text.\n'
open(R/'CONTRAST.md','w').write(md); print(md)
