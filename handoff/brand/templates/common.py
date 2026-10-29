import pathlib
FD='/usr/share/fonts/truetype/sand-box/google'
FONTS=f'''
@font-face{{font-family:"Instrument Serif";src:url("file://{FD}/Instrument Serif/InstrumentSerif-Regular.ttf")}}
@font-face{{font-family:"Instrument Serif";font-style:italic;src:url("file://{FD}/Instrument Serif/InstrumentSerif-Italic.ttf")}}
@font-face{{font-family:"Geist";font-weight:100 900;src:url("file://{FD}/Geist/Geist-VariableFont_wght.ttf")}}
@font-face{{font-family:"Geist Mono";font-weight:100 900;src:url("file://{FD}/Geist Mono/GeistMono-VariableFont_wght.ttf")}}
'''
TOK=dict(bg='#0A0A0B',bg1='#111113',bg2='#17171A',line='#26262B',line2='#34343B',
 text='#F5F3EF',text2='#B9B4AB',text3='#8A867F',cream='#EDE6DA',amber='#FFB547',amberPress='#E0952A',amberDim='#7A5A2B',
 up='#8FD3A8',down='#F2848F',
 statusLive='#8FD3A8',statusPaper='#B7ACE8',statusError='#F2848F',statusIdle='#8A867F')
VARS=':root{'+''.join(f'--{k}:{v};' for k,v in TOK.items())+'}'
BASE=FONTS+VARS+'''*{box-sizing:border-box;margin:0;padding:0}html,body{background:var(--bg);color:var(--text);font-family:Geist,sans-serif;-webkit-font-smoothing:antialiased}
.serif{font-family:"Instrument Serif",serif;font-weight:400}.mono{font-family:"Geist Mono",monospace;font-variant-numeric:tabular-nums}
/* primary button: squared 8px, amber hairline, nock notch on the left edge (not a pill) */
.qbtn{position:relative;display:inline-flex;align-items:center;gap:9px;height:38px;padding:0 14px 0 18px;border-radius:8px;font:500 14px/1 Geist;letter-spacing:-.005em;white-space:nowrap}
.qbtn-p{color:var(--amber);background:rgba(255,181,71,.07);box-shadow:inset 0 0 0 1px rgba(255,181,71,.55)}
.qbtn-p::before{content:"";position:absolute;left:-1px;top:50%;width:7px;height:12px;margin-top:-6px;background:var(--bg);clip-path:polygon(0 0,100% 50%,0 100%);box-shadow:none}
.qbtn-p::after{content:"";position:absolute;left:0;top:50%;width:7px;height:12px;margin-top:-6px;border:0;background:linear-gradient(var(--amber),var(--amber)) 0 0/100% 100%;clip-path:polygon(0 0,100% 50%,0 100%,0 calc(100% - 1.4px),calc(100% - 2.4px) 50%,0 1.4px);opacity:.55}
.qbtn-p svg{width:12px;height:12px}
.qbtn-g{color:var(--text);box-shadow:inset 0 0 0 1px var(--line2);font-family:"Geist Mono";font-size:13px;padding:0 14px}
em{font-style:italic;font-family:"Instrument Serif",serif}'''
import json as _json, os as _os
DEMO=_json.load(open(pathlib.Path(__file__).with_name('demo.json')))
FINAL=_os.environ.get('FINAL')=='1'
def graph3_js(t=1050,period=6000,gap=56,nw=210,step=60):
    """canonical 3-node graph (signal -> trigger -> action) for marketing images; neutral node dots, amber light-arrows only"""
    D=DEMO; s,tr,a=D['signal'],D['trigger'],D['action']
    j=lambda **k:_json.dumps(k)
    nodes=[j(id='s',kind='signal',label=s['label'],title=s['title'],val=s['val'],x=0,y=2*step,w=nw),
           j(id='t',kind='trigger',label=tr['label'],title=tr['title'],sub=tr['sub'],x=nw+gap,y=step,w=nw),
           j(id='a',kind='action',label=a['label'],title=a['title'],sub=a['sub'],x=2*(nw+gap),y=0,w=nw)]
    return f"nodes:[{','.join(nodes)}],edges:[{{from:'s',to:'t',t0:0,t1:1600}},{{from:'t',to:'a',t0:900,t1:2700}}]", 3*nw+2*gap, 2*step+124
MKT_CSS='''/* marketing images: bigger node type, no status pastels */
.mkt .qn{height:124px} .mkt .qn-k{font-size:13px} .mkt .qn-t{font-size:17px} .mkt .qn-v{font-size:26px} .mkt .qn-s{font-size:14px}
.mkt .qn-k i{background:var(--text3)!important} .mkt .qn-trigger .qn-k i{background:var(--cream)!important}'''
