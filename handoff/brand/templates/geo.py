import math, uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
BG='#0A0A0B'; AMBER='#FFB547'; CREAM='#EDE6DA'; TEXT='#F5F3EF'
SERIF='/usr/share/fonts/truetype/sand-box/google/Instrument Serif/InstrumentSerif-Regular.ttf'
def f(v): return f'{v:.2f}'.rstrip('0').rstrip('.')
def arrow(tx,ty,L,w,hl,hw,ang=-45):
    """tail centre (tx,ty), length L to tip, shaft width w, head length hl, head width hw; one closed polygon"""
    a=math.radians(ang); c,s=math.cos(a),math.sin(a)
    pts=[(0,-w/2),(L-hl,-w/2),(L-hl,-hw/2),(L,0),(L-hl,hw/2),(L-hl,w/2),(0,w/2)]
    P=[(tx+x*c-y*s, ty+x*s+y*c) for x,y in pts]
    return 'M'+' L'.join(f'{f(x)} {f(y)}' for x,y in P)+'Z'
# master mark, viewBox 0 0 120 64 ; capsule outline + 3 arrows
def mark_paths(small=False,bold=False):
    if bold:
        sw=7.5; cap=(sw/2,sw/2,120-sw,64-sw)
        L=37; w=8.4; hl=14.5; hw=19; gap=26.5; n=3
    elif not small:
        sw=4.6; cap=(sw/2,sw/2,120-sw,64-sw)
        L=39; w=5.4; hl=12.5; hw=16; gap=23.5
        n=3
    else:
        sw=8; cap=(sw/2,sw/2,120-sw,64-sw)
        L=40; w=9; hl=17; hw=23; gap=32; n=2
    # group: arrows at 45deg, projected extent = L/sqrt2 square
    d=L/math.sqrt(2); span=d+gap*(n-1)
    x0=60-span/2; y0=32+d/2
    # optical: the heads are heavy at top-right, nudge group down-left slightly
    x0-=0.6 if not small else 0.8; y0+=0.4
    arrows=[arrow(x0+i*gap,y0,L,w,hl,hw) for i in range(n)]
    x,y,W,H=cap
    return dict(sw=sw,cap=f'<rect x="{f(x)}" y="{f(y)}" width="{f(W)}" height="{f(H)}" rx="{f(H/2)}"',arrows=arrows)
def small_svg(variant='color',inner=False,tile=None):
    """16px-safe glyph: two heavy arrows, no capsule (the tile edge stands in for it). viewBox 64x64"""
    L=36; w=9.5; hl=15; hw=22; gap=22
    d=L/math.sqrt(2); span=d+gap; x0=32-span/2-0.8; y0=32+d/2+0.8
    a0={'color':AMBER,'mono':CREAM}[variant]
    g=[]
    if tile: g.append(f'<rect width="64" height="64" rx="14" fill="{tile}"/>')
    # back arrow first so amber sits in front
    g.append(f'<path id="arrow-2" d="{arrow(x0+gap,y0,L,w,hl,hw)}" fill="{CREAM}"/>')
    g.append(f'<path id="arrow-1" d="{arrow(x0,y0,L,w,hl,hw)}" fill="{a0}"/>')
    body='\n  '.join(g)
    if inner: return body
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">\n  <title>Quiver</title>\n  {body}\n</svg>\n'
def mark_svg(variant='color',small=False,inner=False,bold=False):
    m=mark_paths(small,bold)
    capc={'color':CREAM,'mono':CREAM,'dark':BG,'ink':BG}[variant]
    a0={'color':AMBER,'mono':CREAM,'dark':BG,'ink':'#C9821C'}[variant]
    other=capc
    g=[f'{m["cap"]} fill="none" stroke="{capc}" stroke-width="{m["sw"]}"/>']
    for i,p in enumerate(m['arrows']):
        g.append(f'<path id="arrow-{i+1}" d="{p}" fill="{a0 if i==0 else other}"/>')
    body='\n  '.join(g)
    if inner: return body
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 64" width="120" height="64">\n  <title>Quiver</title>\n  {body}\n</svg>\n'
def text_path(txt, size, font=SERIF, track=0):
    """outline text with harfbuzz shaping (kerning); returns (d, width, ascender, descender) in px, baseline y=0"""
    blob=hb.Blob.from_file_path(font); face=hb.Face(blob); hf=hb.Font(face)
    buf=hb.Buffer(); buf.add_str(txt); buf.guess_segment_properties(); hb.shape(hf,buf,{'kern':True,'liga':True})
    tt=TTFont(font); gs=tt.getGlyphSet(); order=tt.getGlyphOrder(); upm=tt['head'].unitsPerEm; k=size/upm
    pen=SVGPathPen(gs); bp=BoundsPen(gs); x=0
    for info,pos in zip(buf.glyph_infos,buf.glyph_positions):
        tp=TransformPen(pen,(k,0,0,-k,(x+pos.x_offset)*k,-pos.y_offset*k))
        gs[order[info.codepoint]].draw(tp); gs[order[info.codepoint]].draw(TransformPen(bp,(k,0,0,-k,(x+pos.x_offset)*k,-pos.y_offset*k))); x+=pos.x_advance+track*upm
    hh=tt['hhea']; global LAST_BOUNDS; LAST_BOUNDS=bp.bounds
    return pen.getCommands(), x*k, hh.ascent*k, hh.descent*k, tt['OS/2'].sCapHeight*k
