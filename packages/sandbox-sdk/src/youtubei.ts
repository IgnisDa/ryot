import { Effect } from "@ryot/sandbox-sdk/effect";
import { Innertube } from "youtubei.js/web";

import type { SandboxHost } from "./core";

export * from "youtubei.js/web";

export type YoutubeiHost = SandboxHost<readonly ["httpCall"]>;
export type YoutubeiClientOptions = {
	readonly retrievePlayer?: boolean;
	readonly retrieveInnertubeConfig?: boolean;
};

type RequestParts = {
	url: string;
	method: string;
	body: string | undefined;
	headers: Record<string, string>;
};

type ApprovedDependencyRuntime = <A>(operation: () => Promise<A>) => Promise<A>;

const approvedDependencyRuntimeKey = Symbol.for("@ryot/sandbox-sdk/approved-dependency-runtime");

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;

const withApprovedDependencyRuntime = <A>(operation: () => Promise<A>) => {
	const runtime = Reflect.get(globalThis, approvedDependencyRuntimeKey);
	if (typeof runtime === "function") {
		return (runtime as ApprovedDependencyRuntime)(operation);
	}
	return operation();
};

const mergeHeaders = (target: Record<string, string>, source: unknown) => {
	if (source instanceof Headers) {
		for (const [key, value] of source.entries()) {
			target[key] = value;
		}
	} else if (Array.isArray(source)) {
		for (const entry of source) {
			if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string") {
				target[entry[0]] = entry[1];
			}
		}
	} else {
		const record = asRecord(source);
		if (record) {
			for (const [key, value] of Object.entries(record)) {
				if (typeof value === "string") {
					target[key] = value;
				}
			}
		}
	}
};

const resolveRequestParts = (
	input: Request | string | URL,
	init?: RequestInit,
): Effect.Effect<RequestParts> => {
	const headers: Record<string, string> = {};
	const applyInit = (base: { body: string | undefined; method: string; url: string }) => {
		let method = base.method;
		let body = base.body;
		if (init) {
			if (init.method) {
				method = init.method;
			}
			if (init.headers) {
				mergeHeaders(headers, init.headers);
			}
			const rawBody = init.body;
			if (rawBody !== null && rawBody !== undefined) {
				if (typeof rawBody === "string") {
					body = rawBody;
				} else if (ArrayBuffer.isView(rawBody)) {
					body = new TextDecoder().decode(rawBody);
				} else if (rawBody instanceof ArrayBuffer) {
					body = new TextDecoder().decode(new Uint8Array(rawBody));
				} else if (rawBody instanceof URLSearchParams) {
					body = rawBody.toString();
				}
			}
		}
		return { body, headers, method, url: base.url };
	};
	if (input instanceof Request) {
		mergeHeaders(headers, input.headers);
		return Effect.tryPromise(() => input.text()).pipe(
			Effect.map((text) =>
				applyInit({ body: text ? text : undefined, method: input.method, url: input.url }),
			),
			Effect.catch(() =>
				Effect.succeed(applyInit({ body: undefined, method: input.method, url: input.url })),
			),
		);
	}
	return Effect.succeed(applyInit({ body: undefined, method: "GET", url: String(input) }));
};

const isHostError = (error: unknown): error is { message: string } =>
	typeof asRecord(error)?.["message"] === "string";

const makeFetch = (host: YoutubeiHost): typeof fetch =>
	Object.assign(
		(input: Request | string | URL, init?: RequestInit): Promise<Response> =>
			resolveRequestParts(input, init).pipe(
				Effect.flatMap((parts) => {
					const options: { body?: string; headers?: Record<string, string> } = {};
					if (parts.body !== undefined) {
						options.body = parts.body;
					}
					if (Object.keys(parts.headers).length > 0) {
						options.headers = parts.headers;
					}
					return host.httpCall(parts.method, parts.url, options).pipe(
						Effect.map(
							(result) =>
								new Response(result.body, { headers: result.headers, status: result.status }),
						),
						Effect.catch((error) =>
							isHostError(error)
								? Effect.succeed(new Response(error.message, { status: 500 }))
								: Effect.fail(error),
						),
					);
				}),
				Effect.runPromise,
			),
		{ preconnect: () => undefined },
	);

const wrapClient = <Client extends object>(client: Client): Client =>
	new Proxy(client, {
		get(target, property) {
			const value = Reflect.get(target, property, target);
			if (typeof value === "function") {
				return (...args: readonly unknown[]) =>
					withApprovedDependencyRuntime(async () => value.apply(target, args));
			}
			if (value !== null && typeof value === "object") {
				return wrapClient(value);
			}
			return value;
		},
	});

export const createYoutubeMusicClient = (
	host: YoutubeiHost,
	language?: string,
	options?: YoutubeiClientOptions,
) =>
	Effect.tryPromise(() =>
		withApprovedDependencyRuntime(() =>
			Innertube.create({
				fetch: makeFetch(host),
				generate_session_locally: true,
				...(options?.retrieveInnertubeConfig === false ? { retrieve_innertube_config: false } : {}),
				...(options?.retrievePlayer === false ? { retrieve_player: false } : {}),
				...(language ? { lang: language } : {}),
			}),
		),
	).pipe(Effect.map(wrapClient));

export const createYoutubeHistoryClient = (host: YoutubeiHost, authCookie: string) =>
	Effect.tryPromise(() =>
		withApprovedDependencyRuntime(() =>
			Innertube.create({ cookie: authCookie, fetch: makeFetch(host) }),
		),
	).pipe(Effect.map(wrapClient));
