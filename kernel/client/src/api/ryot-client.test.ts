import { AuthRateLimited, AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import type {
	ContractClient,
	ContractPathParams,
	ContractPayload,
} from "@ryot-app/contract/client";
import type { PluginThemeSnapshot } from "@ryot-app/contract/modules/plugins/client";
import { RyotQLBadRequest, RyotQLInternalError } from "@ryot-app/contract/modules/ryotql/contract";
import {
	UploadBadRequest,
	UploadInternalError,
	type UploadIntentResponse,
} from "@ryot-app/contract/modules/uploads/schemas";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Effect, Layer, ManagedRuntime, Result } from "effect";
import { describe, expect, it } from "vitest";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import { decodeServerOrigin } from "#/api/origin";
import { createKernelRyotClient } from "#/api/ryot-client";
import type { ApiScope } from "#/api/scope";
import type { ThemeStore } from "#/modules/theme/store";

const scope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const document = { queries: {}, output: {} } as PreparedRecipe<unknown>["document"];
const recipe = { document, decode: Result.succeed };
const themeSnapshot: PluginThemeSnapshot = { resolvedMode: "light" };
const theme: ThemeStore = {
	destroy: () => undefined,
	getPreference: () => "light",
	setPreference: () => undefined,
	subscribe: () => () => undefined,
	getSnapshot: () => themeSnapshot,
};

const makeRuntime = (cause: unknown) =>
	ManagedRuntime.make(
		Layer.succeed(AuthenticatedApi, {
			run: () => Effect.fail(new AuthenticatedApiError({ cause })),
		}),
	);

type UploadStep = Effect.Effect<unknown, unknown>;

type FetchCall = {
	readonly url: string;
	readonly body: unknown;
	readonly method: string;
	readonly headers: unknown;
};

const intent: UploadIntentResponse = {
	method: "PUT",
	intentId: "intent-1",
	uploadUrl: "/uploads/local/intent-1",
	expiresAt: "2026-01-01T00:00:00.000Z",
	headers: { "content-type": "text/csv", "x-upload-signature": "signed" },
};

const uploadToken = { token: "temporary-1", expiresAt: "2026-01-01T00:00:00.000Z" };

const makeUploadsRuntime = (
	events: string[],
	steps: { readonly createIntent: UploadStep; readonly completeIntent: UploadStep },
) => {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const client = {
		uploads: {
			createIntent: (request: { payload: ContractPayload<"uploads", "createIntent"> }) => {
				events.push(`create-intent:${request.payload.fileName}`);
				return steps.createIntent;
			},
			completeIntent: (request: { params: ContractPathParams<"uploads", "completeIntent"> }) => {
				events.push(`complete-intent:${request.params.intentId}`);
				return steps.completeIntent;
			},
		},
	} as unknown as ContractClient;
	return ManagedRuntime.make(
		Layer.succeed(AuthenticatedApi, {
			run: <A, E>(_scope: ApiScope, program: (client: ContractClient) => Effect.Effect<A, E>) =>
				program(client).pipe(Effect.mapError((cause) => new AuthenticatedApiError({ cause }))),
		}),
	);
};

const requestUrl = (input: RequestInfo | URL) => {
	if (typeof input === "string") {
		return input;
	}
	return input instanceof URL ? input.href : input.url;
};

const withFetch = async (
	calls: FetchCall[],
	respond: (call: FetchCall) => Promise<Response>,
	run: () => Promise<void>,
) => {
	const original = globalThis.fetch;
	const stub: typeof globalThis.fetch = (input, init = {}) => {
		const call = {
			body: init.body,
			headers: init.headers,
			url: requestUrl(input),
			method: init.method ?? "GET",
		} satisfies FetchCall;
		calls.push(call);
		return respond(call);
	};
	globalThis.fetch = stub;
	try {
		await run();
	} finally {
		globalThis.fetch = original;
	}
};

const accepted = new Response(null, { status: 204 });
const forbidden = new Response(null, { status: 403 });
const source = new Blob(["id,title"], { type: "text/csv" });
const uploadRequest = { source, fileName: "items.csv", contentType: "text/csv" };

describe("kernel Ryot client", () => {
	const declaredFailures = [
		new AuthUnauthorized({ reason: { code: "authentication-required" } }),
		new AuthRateLimited({ reason: { code: "api-key-rate-limited", retryAfterMs: 30_000 } }),
		new RyotQLBadRequest({ reason: { code: "invalid-query" } }),
		new RyotQLInternalError({ reason: { code: "execution-failed" } }),
	];

	for (const failure of declaredFailures) {
		it(`classifies ${failure._tag} as query-failed`, async () => {
			const runtime = makeRuntime(failure);
			try {
				const client = createKernelRyotClient(runtime, scope, theme);
				await expect(client.data.query(recipe)).rejects.toMatchObject({ reason: "query-failed" });
			} finally {
				await runtime.dispose();
			}
		});
	}

	it("classifies an unexpected failure as transport", async () => {
		const runtime = makeRuntime(new TypeError("private network detail"));
		try {
			const client = createKernelRyotClient(runtime, scope, theme);
			await expect(client.data.query(recipe)).rejects.toMatchObject({ reason: "transport" });
		} finally {
			await runtime.dispose();
		}
	});

	it("interrupts a query with the caller signal and preserves its abort reason", async () => {
		const runtime = ManagedRuntime.make(
			Layer.succeed(AuthenticatedApi, { run: () => Effect.never }),
		);
		const controller = new AbortController();
		const reason = new DOMException("Caller canceled", "AbortError");
		try {
			const client = createKernelRyotClient(runtime, scope, theme);
			const query = client.data.query(recipe, { signal: controller.signal });

			controller.abort(reason);

			await expect(query).rejects.toBe(reason);
		} finally {
			await runtime.dispose();
		}
	});
});

describe("kernel temporary uploads", () => {
	it("creates an intent, transfers the bytes with its method and headers, then completes it", async () => {
		const events: string[] = [];
		const calls: FetchCall[] = [];
		const runtime = makeUploadsRuntime(events, {
			createIntent: Effect.succeed(intent),
			completeIntent: Effect.succeed(uploadToken),
		});
		try {
			const client = createKernelRyotClient(runtime, scope, theme);
			await withFetch(
				calls,
				(call) => {
					events.push(`put:${call.url}`);
					return Promise.resolve(accepted);
				},
				async () => {
					await expect(client.uploads.uploadTemporary(uploadRequest)).resolves.toEqual(uploadToken);
				},
			);

			expect(events).toEqual([
				"create-intent:items.csv",
				"put:https://ryot.example/api/uploads/local/intent-1",
				"complete-intent:intent-1",
			]);
			expect(calls).toEqual([
				{
					body: source,
					method: "PUT",
					headers: { ...intent.headers },
					url: "https://ryot.example/api/uploads/local/intent-1",
				},
			]);
		} finally {
			await runtime.dispose();
		}
	});

	it("classifies a declared intent failure as operation-failed and skips the transfer", async () => {
		const events: string[] = [];
		const calls: FetchCall[] = [];
		const runtime = makeUploadsRuntime(events, {
			completeIntent: Effect.succeed(uploadToken),
			createIntent: Effect.fail(
				new UploadBadRequest({
					reason: { code: "unsupported-file-type", contentType: "text/csv" },
				}),
			),
		});
		try {
			const client = createKernelRyotClient(runtime, scope, theme);
			await withFetch(
				calls,
				() => Promise.resolve(accepted),
				async () => {
					await expect(client.uploads.uploadTemporary(uploadRequest)).rejects.toMatchObject({
						reason: "operation-failed",
					});
				},
			);

			expect(events).toEqual(["create-intent:items.csv"]);
			expect(calls).toEqual([]);
		} finally {
			await runtime.dispose();
		}
	});

	it("classifies an unexpected intent failure as transport", async () => {
		const events: string[] = [];
		const runtime = makeUploadsRuntime(events, {
			completeIntent: Effect.succeed(uploadToken),
			createIntent: Effect.fail(new TypeError("private network detail")),
		});
		try {
			const client = createKernelRyotClient(runtime, scope, theme);
			await expect(client.uploads.uploadTemporary(uploadRequest)).rejects.toMatchObject({
				reason: "transport",
			});
		} finally {
			await runtime.dispose();
		}
	});

	it("classifies a rejected byte transfer and never completes the intent", async () => {
		const events: string[] = [];
		const calls: FetchCall[] = [];
		const runtime = makeUploadsRuntime(events, {
			createIntent: Effect.succeed(intent),
			completeIntent: Effect.succeed(uploadToken),
		});
		try {
			const client = createKernelRyotClient(runtime, scope, theme);
			await withFetch(
				calls,
				() => Promise.resolve(forbidden),
				async () => {
					await expect(client.uploads.uploadTemporary(uploadRequest)).rejects.toMatchObject({
						reason: "operation-failed",
					});
				},
			);
			await withFetch(
				calls,
				() => Promise.reject(new TypeError("Failed to fetch")),
				async () => {
					await expect(client.uploads.uploadTemporary(uploadRequest)).rejects.toMatchObject({
						reason: "transport",
					});
				},
			);

			expect(events).toEqual(["create-intent:items.csv", "create-intent:items.csv"]);
			expect(calls).toHaveLength(2);
		} finally {
			await runtime.dispose();
		}
	});

	it("classifies a failed completion after the bytes are transferred", async () => {
		const events: string[] = [];
		const calls: FetchCall[] = [];
		const runtime = makeUploadsRuntime(events, {
			createIntent: Effect.succeed(intent),
			completeIntent: Effect.fail(
				new UploadInternalError({ reason: { code: "unexpected-error" } }),
			),
		});
		try {
			const client = createKernelRyotClient(runtime, scope, theme);
			await withFetch(
				calls,
				() => Promise.resolve(accepted),
				async () => {
					await expect(client.uploads.uploadTemporary(uploadRequest)).rejects.toMatchObject({
						reason: "operation-failed",
					});
				},
			);

			expect(events).toEqual(["create-intent:items.csv", "complete-intent:intent-1"]);
		} finally {
			await runtime.dispose();
		}
	});

	it("rejects a completion that resolves to a managed asset instead of a token", async () => {
		const events: string[] = [];
		const calls: FetchCall[] = [];
		const runtime = makeUploadsRuntime(events, {
			createIntent: Effect.succeed(intent),
			completeIntent: Effect.succeed({ key: "assets/items.csv", type: "local" }),
		});
		try {
			const client = createKernelRyotClient(runtime, scope, theme);
			await withFetch(
				calls,
				() => Promise.resolve(accepted),
				async () => {
					await expect(client.uploads.uploadTemporary(uploadRequest)).rejects.toMatchObject({
						reason: "malformed-result",
					});
				},
			);
		} finally {
			await runtime.dispose();
		}
	});
});
