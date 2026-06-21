import getPort from "get-port";

export type FakeHttpServer = {
	url: string;
	stop: () => void;
	requests: Array<{ body: unknown; path: string }>;
};

export async function startFakeHttpServer(
	respond: (url: URL, request: Request) => Response | Promise<Response> = () =>
		Response.json({ ok: true }),
): Promise<FakeHttpServer> {
	const port = await getPort();
	const requests: FakeHttpServer["requests"] = [];
	const server = Bun.serve({
		port,
		hostname: "127.0.0.1",
		fetch: async (request) => {
			const url = new URL(request.url);
			requests.push({ path: url.pathname, body: await request.json().catch(() => null) });
			return respond(url, request);
		},
	});
	return {
		requests,
		url: `http://127.0.0.1:${port}`,
		stop: () => void server.stop(true),
	};
}
