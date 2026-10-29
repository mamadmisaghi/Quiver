import SignInButton from "./SignInButton";

/** Loading / error / signed-out state for a data screen. Pass the useQ result as `q` for retry and Sign in. */
const Loading = ({ h = 240, error, q }: { h?: number; error?: string | null; q?: { error: string | null; auth: boolean; reload: () => void } }) => {
  const e = error ?? q?.error ?? null;
  return (
    <div style={{ minHeight: h }} className="mt-8 grid place-items-center rounded-[14px] border border-line bg-card px-5 text-center text-[13.5px] text-muted" role={e ? undefined : "status"}>
      {!e ? "Loading…" : (
        <div className="flex flex-col items-center gap-4">
          <p role="alert" className="text-ink-2">{e}</p>
          {q?.auth ? <SignInButton /> : q && <button type="button" onClick={q.reload} className="btn rounded-full border border-line-2 px-4 py-1.5 text-[13px] hover:border-white/30">Try again</button>}
        </div>)}
    </div>);
};
export default Loading;
