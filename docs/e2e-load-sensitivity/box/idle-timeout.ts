const server = Bun.serve({
	port: 0,
	idleTimeout: 8,
	async fetch(req) {
		const started = Date.now();
		req.signal.addEventListener("abort", () => console.log(`server: ${req.method} ${new URL(req.url).pathname} aborted after ${Date.now() - started}ms`));
		await req.text();
		await Bun.sleep(20000);
		return new Response("ok");
	},
});
const base = `http://localhost:${server.port}`;
const attempt = async (label: string, init: RequestInit) => {
	const started = Date.now();
	try {
		const res = await fetch(`${base}/${label}`, init);
		console.log(`client ${label}: ${res.status} after ${Date.now() - started}ms`);
	} catch (error) {
		console.log(`client ${label}: error after ${Date.now() - started}ms: ${error}`);
	}
};
await Promise.all([
	attempt("post-json", { method: "POST", body: JSON.stringify({ a: 1 }), headers: { "content-type": "application/json" } }),
	attempt("delete-nobody", { method: "DELETE" }),
	attempt("post-empty", { method: "POST" }),
	attempt("get", {}),
]);
server.stop(true);
