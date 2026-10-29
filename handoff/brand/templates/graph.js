// Quiver live graph: orthogonal edges, light-arrows travel along them. Deterministic: render(tMs).
(function(){
const NS='http://www.w3.org/2000/svg';
window.QGraph=function(root,opts){
  const W=opts.w,H=opts.h,nodes=opts.nodes,edges=opts.edges,P=opts.period||6000;
  root.style.position='relative';root.style.width=W+'px';root.style.height=H+'px';
  const svg=document.createElementNS(NS,'svg');svg.setAttribute('width',W);svg.setAttribute('height',H);svg.style.position='absolute';svg.style.inset=0;root.appendChild(svg);
  const el={};
  nodes.forEach(n=>{const d=document.createElement('div');d.className='qn qn-'+n.kind;d.style.left=n.x+'px';d.style.top=n.y+'px';d.style.width=(n.w||190)+'px';
    d.innerHTML=`<div class="qn-k"><i></i>${n.label}</div><div class="qn-t">${n.title}</div>`+(n.val!==undefined?`<div class="qn-v mono"><span class="v">${n.val}</span><span class="u">${n.unit||''}</span></div>`:'')+(n.sub?`<div class="qn-s mono">${n.sub}</div>`:'');
    root.appendChild(d);el[n.id]={n,d};});
  const port=(id,side)=>{const {n,d}=el[id];const w=n.w||190,h=d.offsetHeight;return side==='out'?[n.x+w,n.y+h/2]:[n.x,n.y+h/2];};
  const E=edges.map(e=>{const [x1,y1]=port(e.from,'out'),[x2,y2]=port(e.to,'in');const mx=e.mx!==undefined?e.mx:(x1+x2)/2;const r=Math.min(12,Math.abs(y2-y1)/2);const s=Math.sign(y2-y1);
    const d=Math.abs(y2-y1)<1?`M${x1} ${y1}H${x2}`:`M${x1} ${y1}H${mx-r}Q${mx} ${y1} ${mx} ${y1+s*r}V${y2-s*r}Q${mx} ${y2} ${mx+r} ${y2}H${x2}`;
    const base=document.createElementNS(NS,'path');base.setAttribute('d',d);base.setAttribute('class','qe');svg.appendChild(base);
    const lit=document.createElementNS(NS,'path');lit.setAttribute('d',d);lit.setAttribute('class','qe-lit');svg.appendChild(lit);
    const tails=[0.18,0.42,1].map((o,i)=>{const p=document.createElementNS(NS,'path');p.setAttribute('d',d);p.setAttribute('class','qa-tail');p.style.opacity=o;svg.appendChild(p);return p;});
    const head=document.createElementNS(NS,'path');head.setAttribute('d','M-7 -4.5 L1.5 0 L-7 4.5 L-5 0 Z');head.setAttribute('class','qa-head');svg.appendChild(head);
    const dot=document.createElementNS(NS,'circle');dot.setAttribute('r',3);dot.setAttribute('class','qport');dot.setAttribute('cx',x2);dot.setAttribute('cy',y2);svg.appendChild(dot);
    const dot2=document.createElementNS(NS,'circle');dot2.setAttribute('r',3);dot2.setAttribute('class','qport');dot2.setAttribute('cx',x1);dot2.setAttribute('cy',y1);svg.appendChild(dot2);
    return {e,base,lit,tails,head,dot,len:base.getTotalLength()};});
  const ease=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2; // power2.inOut
  function render(t){
    t=((t%P)+P)%P;
    E.forEach(o=>{const {e,len}=o;const a=e.t0,b=e.t1;let k=(t-a)/(b-a);
      const on=k>=0&&k<=1;const pos=ease(Math.max(0,Math.min(1,k)))*len;
      [26,14,6].forEach((L,i)=>{const p=o.tails[i];if(!on){p.style.visibility='hidden';return;}p.style.visibility='visible';const l=Math.min(L*2.2,pos);p.setAttribute('stroke-dasharray',`${l} ${len+100}`);p.setAttribute('stroke-dashoffset',-(pos-l));});
      if(on){const q=o.base.getPointAtLength(pos),q0=o.base.getPointAtLength(Math.max(0,pos-1.5));const ang=Math.atan2(q.y-q0.y,q.x-q0.x)*180/Math.PI;o.head.style.visibility='visible';o.head.setAttribute('transform',`translate(${q.x} ${q.y}) rotate(${ang})`);}else o.head.style.visibility='hidden';
      // edge glow stays briefly after arrival
      const after=(t-b)/700; const lit=on?0.35*k:(after>=0&&after<1?0.35*(1-after):0);o.lit.style.opacity=lit;
      const ping=(after>=0&&after<1)?1-after:0;o.dot.style.opacity=0.35+0.65*ping;o.dot.setAttribute('r',3+ping*1.5);
      const tgt=el[e.to].d;tgt.style.setProperty('--ping',Math.max(+tgt.dataset.p||0,ping));tgt.dataset.p=Math.max(+tgt.dataset.p||0,ping);
    });
    Object.values(el).forEach(({n,d})=>{d.style.setProperty('--ping',d.dataset.p||0);d.dataset.p=0;
      if(n.live){const v=n.live(t/P);const s=d.querySelector('.v');if(s)s.textContent=v;}});
  }
  return {render,period:P};
};
})();
