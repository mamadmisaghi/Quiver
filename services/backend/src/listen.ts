/** M5.26: listener options for @hono/node-server serve(). HOST defaults to 127.0.0.1 (config). */
export const listenOpts = (c: { HOST: string; PORT: number }) => ({ hostname: c.HOST, port: c.PORT });
