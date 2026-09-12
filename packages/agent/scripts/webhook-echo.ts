/**
 * Throwaway webhook receiver, for proving the REST push works without standing
 * up a backend. Run it, then start the agent with WEBHOOK_URL pointing here.
 *
 *   bun run echo
 *   WEBHOOK_URL=http://localhost:4000/hook bun run start
 */
const port = Number(process.env.ECHO_PORT ?? 4000);

Bun.serve({
  port,
  async fetch(req) {
    const body = await req.json().catch(() => null);
    console.log(`\n← ${req.method} ${new URL(req.url).pathname}`);
    console.log(JSON.stringify(body, null, 2));
    return Response.json({ received: true });
  },
});

console.log(`webhook echo listening on http://localhost:${port}/hook`);
