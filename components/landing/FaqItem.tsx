"use client";
import { useId, useState } from "react";
import DisclosurePanel from "../DisclosurePanel";

export default function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className="q-faq-item">
    <h3><button type="button" className="q-faq-question" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      {question}<span aria-hidden="true">+</span>
    </button></h3>
    <DisclosurePanel id={id} open={open}><p className="q-faq-answer">{answer}</p></DisclosurePanel>
  </div>;
}
