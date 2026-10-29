// M5.27: shared local-anvil helper. Root cause of the m50 flake: m50-anvil-readonly and m523-testpool both hard-coded
// port 18547. Run in parallel, the second anvil failed to bind and its test silently talked to the OTHER file's chain
// (wrong contracts / nonces). Now each file gets an OS-assigned free port and we confirm the RPC is served by OUR process.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
export const BIN = join(homedir(), ".foundry/bin");
export const freePort = () => new Promise<number>((res, rej) => { const s = createServer(); s.unref(); s.on("error", rej);
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); });
export async function startAnvil(chainId: number): Promise<{ proc: ChildProcess; rpc: string; port: number }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = await freePort(); const rpc = `http://127.0.0.1:${port}`;
    const proc = spawn(join(BIN, "anvil"), ["--port", String(port), "--silent", "--chain-id", String(chainId)], { stdio: "ignore" });
    let exited = false; proc.once("exit", () => { exited = true; });
    for (let i = 0; i < 100 && !exited; i++) {
      try { const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
        const j = (await r.json()) as { result?: string }; if (!exited && Number(j.result) === chainId) return { proc, rpc, port }; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 50)); }
    proc.kill(); // port was grabbed between probe and bind (or anvil died): pick another port
  }
  throw new Error("anvil failed to start on a free port");
}
