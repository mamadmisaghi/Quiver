import Link from "@/components/Link";
import FlightField from "@/src/motion/FlightField";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import PreviewWorkflow from "@/components/landing/PreviewWorkflow";
import { WhatItReads, Safety, Token, Faq, FinalCta } from "@/components/landing/Sections";
import { Fork, PaperPreview, WhatItTrades } from "@/components/landing/LandingLive";
import { PieChart, ShieldCheck, ListOrdered, ArrowUpRight, ArrowRight } from "lucide-react";
import VenueMark from "@/components/VenueMark";
import { DESIGN } from "@/lib/design";

export default function Home() {
  const example=`If Fed-cut odds on Polymarket pass 70% and NVDA trades below its 20-day average, buy $200 of NVDA.${DESIGN === "b" ? " Then open a $250 SOL long at 2× on Hyperliquid." : ""} Stop at −8%.`;
  return <><SiteHeader /><main className="q-landing">
    <section className="q-hero">
      <FlightField className="q-hero-field" />
      <div className="q-landing-width">
        <div className="q-hero-grid">
          <div className="q-hero-copy">
            {DESIGN === "c" && <span className="q-preview-label"><i />Strategy builder</span>}
            <h1>Type an idea.<br />Watch it <em>trade.</em></h1>
            <p>Describe a strategy. Review every rule.<br className="hidden sm:block" /> Practice with paper trades.</p>
            <div className="q-hero-actions"><Link href="/app/new" className="q-action q-primary">Build a strategy</Link><a href="#how" className="q-action">How it works</a></div>
          </div>
          <div className="q-hero-product"><div className="q-product-caption"><span><i />Strategy workflow</span></div><PreviewWorkflow /><div className="q-product-foot"><span>Signals</span><ArrowRight size={12} /><span>Trigger</span><ArrowRight size={12} /><span>Action</span><ArrowRight size={12} /><span>Exit</span></div></div>
        </div>
        <div className="q-venue-strip">
          <span className="q-venue-intro">One workspace.<br />Four market perspectives.</span>
          {([['robinhood','Robinhood Chain','Stock tokens'],['solana','Solana','Token markets'],['hyperliquid','Hyperliquid','Perpetuals'],['polymarket','Polymarket','Watch signals']] as const).map(([v,n,s]) => <Link href="/#trades" key={v} className="q-venue"><VenueMark venue={v} size={28} /><span><strong>{n}</strong><small>{s}<ArrowUpRight size={12} /></small></span></Link>)}
        </div>
      </div>
    </section>
    <section className="q-how q-landing-width" id="how">
      <div className="q-section-heading"><div><h2>One idea. Every rule <em>visible.</em></h2><p>Turn a plain-English idea into a clear strategy with transparent rules.</p></div><Link href="/app/new" className="q-text-link">Try the builder<ArrowUpRight size={16} /></Link></div>
      <ol className="q-steps">{[['Describe','Type your idea in plain English. Quiver interprets it.'],['Review','Inspect every condition, order and risk limit.'],['Practice','Run your rules in a dedicated paper session.']].map(([t,d],i)=><li key={t}><span>{i+1}</span><div><h3>{t}</h3><p>{d}</p></div>{i<2 && <ArrowRight size={18} className="q-step-arrow" />}</li>)}</ol>
      <div className="q-rule-example" id="draft">{DESIGN === "b" ? <><div className="q-example-input"><span className="q-small-heading">Explain the idea in plain English</span><p>{example}</p><Link href={`/app/new?q=${encodeURIComponent(example)}`} className="q-action q-primary">Build this strategy<ArrowUpRight size={14}/></Link></div><div className="q-example-result"><span className="q-small-heading">Generated strategy graph</span><PreviewWorkflow probability crossVenue /></div></> : <><div className="q-example-heading"><span>Fed cut on Polymarket + NVDA dip</span><Link href={`/app/new?q=${encodeURIComponent(example)}`} className="q-text-link">View full strategy<ArrowUpRight size={14}/></Link></div><PreviewWorkflow probability /></>}</div>
      <div className="q-boundaries"><div><h2>Set the boundaries.</h2><p>Define clear risk limits for every strategy.</p></div><div className="q-boundary-values">{[{Icon:PieChart,label:'Position size',value:'25%',detail:'of equity'},{Icon:ShieldCheck,label:'Daily loss limit',value:'10%',detail:'pause at the limit'},{Icon:ListOrdered,label:'Max orders per day',value:'20',detail:'across all actions'}].map(({Icon,label,value,detail})=><Link href="/app/risk" key={label}><Icon size={22} strokeWidth={1.4}/><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></Link>)}</div></div>
    </section>
    <div className="q-landing-rest"><WhatItTrades /><WhatItReads /><PaperPreview /><Safety /><Fork /><Token /><Faq /><FinalCta /></div>
  </main><SiteFooter /></>;
}
