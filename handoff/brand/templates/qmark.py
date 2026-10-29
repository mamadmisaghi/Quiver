"""Quiver v3 mark: open, angled quiver body with fletched arrows fanning out. viewBox 0 0 100 100. All fills, real gaps (no bg-coloured strokes)."""
import math
from geo import f, BG, AMBER, CREAM
INK_AMBER='#C9821C'
def T(pts,ang,cx,cy,ox=0,oy=0):
    a=math.radians(ang); c,s=math.cos(a),math.sin(a)
    return [(cx+(x+ox)*c-(y+oy)*s, cy+(x+ox)*s+(y+oy)*c) for x,y in pts]
def poly(P): return 'M'+' L'.join(f'{f(x)} {f(y)}' for x,y in P)+'Z'
def arc_pts(cx,cy,r,a0,a1,n=14): return [(cx+r*math.cos(math.radians(a0+(a1-a0)*i/n)),cy+r*math.sin(math.radians(a0+(a1-a0)*i/n))) for i in range(n+1)]
# local frame: quiver axis vertical, mouth at y=0, up is -y
def body(simple):
    tw,bw,h=11,8.6,38; lip=4.2; lo=1.5
    k=lambda y:tw-(tw-bw)*(y/h)
    if simple:
        tw,bw,h,lip=14,11,22,6
        k=lambda y:tw-(tw-bw)*(y/h)
        return [[(-tw-lo,0),(tw+lo,0),(tw+lo*0.6,lip)]+[(k(h),h)]+arc_pts(0,h,bw,0,180)+[(-tw-lo*0.6,lip)]]
    g=2.4; y0=lip+g
    return [[(-tw-lo,0),(tw+lo,0),(tw+lo*0.7,lip),(-tw-lo*0.7,lip)],
            [(-k(y0),y0),(k(y0),y0),(k(h),h)]+arc_pts(0,h,bw,0,180)+[(-k(h),h)]]
PIV=30
def fletched(L,w,fl,fw,head=False,hl=0,hw=0,nock=2.4):
    """arrow from pivot (inside quiver) up to y=PIV-L"""
    base=12; top=PIV-L; P=[]
    if head:
        P.append([(-w/2,base),(w/2,base),(w/2,top+hl),(hw/2,top+hl+2.2),(0,top),(-hw/2,top+hl+2.2),(-w/2,top+hl)])
    else:
        P.append([(-w/2,base),(w/2,base),(w/2,top),(0,top+nock),(-w/2,top)])
        sw=fw*0.9
        for s in (-1,1):
            P.append([(s*(w/2-0.7),top+1.5+fl),(s*(w/2-0.7),top+1.5),(s*(w/2+fw),top+1.5-sw),(s*(w/2+fw),top+1.5-sw+fl)])
    return P
OPTIONS={
 'A':dict(name='Fletch fan',lean=14,fan=[-19,0,19],L=[58,64,58],amber=1,head=[False]*3,w=3.4,fl=13,fw=5.4),
 'B':dict(name='Broadheads',lean=14,fan=[-17,0,17],L=[56,64,56],amber=1,head=[True]*3,w=3.6,hl=11,hw=12),
 'C':dict(name='Drawn arrow',lean=14,fan=[-16,0,22],L=[54,58,72],amber=2,head=[False,False,True],w=3.4,fl=13,fw=5.4,hl=12,hw=13),
}
def _shapes(opt,variant,simple):
    o=OPTIONS[opt]
    cream={'color':CREAM,'mono':CREAM,'ink':BG}[variant]; amb={'color':AMBER,'mono':CREAM,'ink':INK_AMBER}[variant]
    fan,Ls,heads,ai=o['fan'],o['L'],o['head'],o['amber']
    w,fl,fw,hl,hw=o['w'],o.get('fl',13),o.get('fw',5.4),o.get('hl',12),o.get('hw',13)
    if simple:
        idx=[0,2] if opt!='C' else [0,2]
        fan=[fan[i]*1.3 for i in idx]; Ls=[Ls[i] for i in idx]; heads=[heads[i] for i in idx]; ai=1
        w*=2.6; fl*=1.25; fw*=1.35; hl*=1.45; hw*=1.5; Ls=[L*0.98 for L in Ls]
    out=[]
    for i,(a,L,hd) in enumerate(zip(fan,Ls,heads)):
        if i!=ai:
            for P in fletched(L,w,fl,fw,hd,hl,hw): out.append((T(T(P,a,0,PIV,0,-PIV),o['lean'],0,0),cream))
    for P in fletched(Ls[ai],w,fl,fw,heads[ai],hl,hw): out.append((T(T(P,fan[ai],0,PIV,0,-PIV),o['lean'],0,0),amb))
    for P in body(simple): out.append((T(P,o['lean'],0,0),cream))
    return out
def _fit(opt,variant,simple):
    sh=_shapes(opt,variant,simple)
    xs=[x for P,_ in sh for x,_y in P]; ys=[y for P,_ in sh for _x,y in P]
    x0,x1,y0,y1=min(xs),max(xs),min(ys),max(ys); k=100/(y1-y0)
    return sh,x0,y0,k,(x1-x0)*k
def dims(opt='A',simple=False): return _fit(opt,'color',simple)[4],100
def mark_inner(opt='A',variant='color',simple=False):
    sh,x0,y0,k,W=_fit(opt,variant,simple)
    return '\n  '.join(f'<path d="{poly([((x-x0)*k,(y-y0)*k) for x,y in P])}" fill="{c}"/>' for P,c in sh)
def mark_svg(opt='A',variant='color',simple=False,inner=False,tile=None):
    b=mark_inner(opt,variant,simple); W,H=dims(opt,simple)
    if inner: return b
    if tile:  # square backing tile for favicons; mark at 74% height
        S=136; k=74/100*S/100; return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}"><title>Quiver</title><rect width="{S}" height="{S}" rx="30" fill="{tile}"/><g transform="translate({f((S-W*k)/2)} {f((S-100*k)/2)}) scale({k:.5f})">{b}</g></svg>\n'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(W)} {H}" width="{f(W)}" height="{H}">\n  <title>Quiver</title>\n  {b}\n</svg>\n'

# ---------------- v4: v2 capsule kept exactly + real archery arrows (default) ----------------
# Coordinates are the v2 120x64 artboard; exported viewBox is scaled to height 100 (187.5 wide) to match the A/B/C pipeline.
V4_CAP=dict(full=(2.3,4.6), simple=(3.75,7.5))   # v2 capsule inset/stroke: full = v2 mark, simple = v2 bold (small-size) capsule
def _arch(L,sw,hl,hw,nk,vl,vh,vb,n=2,fw=2.6,fg=1.6,sk=3.2):
    """real arrow along +x: nock at 0, tip at L. Barbed head; fletching = n swept feather vanes per side
    (parallelograms raked back toward the nock, separated by real gaps)."""
    h=sw
    P=[(0,-h),(L-hl*0.8,-h),(L-hl,-hw),(L,0),(L-hl,hw),(L-hl*0.8,h),(0,h)]
    out=[P]
    for i in range(n):
        x0=vb+i*(fw+fg)          # where this feather leaves the shaft (front edge)
        q=[(x0+fw,-h+0.2),(x0+fw-sk,-vh),(x0-sk,-vh),(x0,-h+0.2)]
        out+= [q,[(x,-y) for x,y in q]]
    return out
def _v4_arrows(simple):
    if simple:
        geo=dict(L=40,sw=2.4,hl=12.5,hw=6.8,nk=0,vl=0,vh=7.4,vb=4.2,n=2,fw=4.4,fg=2.4,sk=4.2); cen=[(45.5,32.6),(75.5,32.6)]
    else:
        geo=dict(L=39,sw=1.15,hl=9.4,hw=4.0,nk=0,vl=0,vh=4.8,vb=2.8,n=3,fw=2.4,fg=1.35,sk=2.8); cen=[(35.95,32.36),(59.45,32.36),(82.95,32.36)]
    out=[]; a=math.radians(-45); c,s=math.cos(a),math.sin(a)
    for cx,cy in cen:
        polys=[[(cx+(x-geo['L']/2)*c-y*s, cy+(x-geo['L']/2)*s+y*c) for x,y in P] for P in _arch(**geo)]
        out.append(polys)
    return out
def v4_svg(variant='color',simple=False,inner=False,tile=None):
    capc={'color':CREAM,'mono':CREAM,'ink':BG}[variant]; a0={'color':AMBER,'mono':CREAM,'ink':INK_AMBER}[variant]
    i0,sw=V4_CAP['simple' if simple else 'full']
    g=[f'<rect id="capsule" x="{i0}" y="{i0}" width="{f(120-2*i0)}" height="{f(64-2*i0)}" rx="{f((64-2*i0)/2)}" fill="none" stroke="{capc}" stroke-width="{sw}"/>']
    for i,polys in enumerate(_v4_arrows(simple)):
        g.append(f'<g id="arrow-{i+1}" fill="{a0 if i==0 else capc}">'+''.join(f'<path d="{poly(P)}"/>' for P in polys)+'</g>')
    b=f'<g transform="scale({100/64:.6f})">'+''.join(g)+'</g>'
    if inner: return b
    W=187.5
    if tile:
        S=136; k=0.86*S/W; return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}"><title>Quiver</title><rect width="{S}" height="{S}" rx="30" fill="{tile}"/><g transform="translate({f((S-W*k)/2)} {f((S-100*k)/2)}) scale({k:.5f})">{b}</g></svg>\n'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 187.5 100" width="187.5" height="100">\n  <title>Quiver</title>\n  {b}\n</svg>\n'
_dims_abc=dims; _svg_abc=mark_svg
def dims(opt='v4',simple=False): return (187.5,100) if opt=='v4' else _dims_abc(opt,simple)
def mark_svg(opt='v4',variant='color',simple=False,inner=False,tile=None):
    return v4_svg(variant,simple,inner,tile) if opt=='v4' else _svg_abc(opt,variant,simple,inner,tile)
