// TEMP(sandbox-benchmark): shared helpers for the show-completion benchmark.
const BASE = process.env.RYOT_BENCH_BASE ?? "http://localhost:3000";

export type Session = { cookie: string; apiKey: string; userId: string };

const ORIGIN = process.env.RYOT_BENCH_ORIGIN ?? process.env.FRONTEND_URL ?? "http://localhost:8000";
const jsonHeaders = { "Content-Type": "application/json", Origin: ORIGIN };

async function readBody(res: Response): Promise<unknown> {
	const text = await res.text();
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

export async function authenticate(): Promise<Session> {
	const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
	const email = `bench-${suffix}@example.com`;
	const password = "BenchPassword123!";

	const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
		method: "POST",
		headers: jsonHeaders,
		body: JSON.stringify({ email, password, name: `Bench ${suffix}` }),
	});
	if (!signUp.ok) {
		throw new Error(`sign-up failed (${signUp.status}): ${JSON.stringify(await readBody(signUp))}`);
	}

	const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, {
		method: "POST",
		headers: jsonHeaders,
		body: JSON.stringify({ email, password }),
	});
	if (!signIn.ok) {
		throw new Error(`sign-in failed (${signIn.status}): ${JSON.stringify(await readBody(signIn))}`);
	}
	const setCookie = signIn.headers.getSetCookie?.() ?? [];
	const cookie = setCookie.map((entry) => entry.split(";")[0]).join("; ");
	const signInBody = (await readBody(signIn)) as { user?: { id?: string } };
	const userId = signInBody.user?.id ?? "";
	if (!cookie) {
		throw new Error("sign-in returned no session cookie");
	}

	const apiKeyRes = await fetch(`${BASE}/api/auth/api-key/create`, {
		method: "POST",
		headers: { ...jsonHeaders, cookie },
		body: JSON.stringify({ name: "bench" }),
	});
	if (!apiKeyRes.ok) {
		throw new Error(
			`api-key create failed (${apiKeyRes.status}): ${JSON.stringify(await readBody(apiKeyRes))}`,
		);
	}
	const apiKeyBody = (await readBody(apiKeyRes)) as { key?: string };
	const apiKey = apiKeyBody.key ?? "";
	if (!apiKey) {
		throw new Error("api-key create returned no key");
	}

	return { cookie, apiKey, userId };
}

export async function api(
	session: Session,
	method: string,
	path: string,
	body?: unknown,
): Promise<{ status: number; data: unknown }> {
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers: {
			"X-Api-Key": session.apiKey,
			...(body !== undefined ? jsonHeaders : {}),
		},
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	return { status: res.status, data: await readBody(res) };
}

export const base = BASE;
