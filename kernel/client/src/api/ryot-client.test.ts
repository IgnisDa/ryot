import type { PluginThemeSnapshot } from "@ryot-app/client-plugin-contract";
import { AuthRateLimited, AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import type { ContractSuccess } from "@ryot-app/contract/client";
import {
	CollectionBadRequest,
	CollectionResponse,
	MembershipResponse,
} from "@ryot-app/contract/modules/collections/schemas";
import { RyotQLBadRequest, RyotQLInternalError } from "@ryot-app/contract/modules/ryotql/contract";
import {
	UploadBadRequest,
	UploadInternalError,
	type UploadIntentResponse,
} from "@ryot-app/contract/modules/uploads/schemas";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Effect, Layer, ManagedRuntime, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { AuthenticatedApiError } from "#/api/authenticated";
import { decodeServerOrigin } from "#/api/origin";
import {
	makeCollectionsApi,
	makeEntityInterestService,
	makeRyotQLApi,
	makeUploadsApi,
} from "#/api/ports.test-layer";
import { createKernelRyotClient, createKernelRyotClientStore } from "#/api/ryot-client";
import type { ThemeStore } from "#/modules/theme/store";
import type { ClientRuntime } from "#/runtime";

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

const fails = (cause: unknown) => Effect.fail(new AuthenticatedApiError({ cause }));

const makeRuntime = (cause: unknown) =>
	ManagedRuntime.make(
		Layer.mergeAll(
			makeCollectionsApi(),
			makeEntityInterestService(),
			makeUploadsApi(),
			makeRyotQLApi({ execute: () => fails(cause) }),
		),
	);

type UploadStep<M extends "createIntent" | "completeIntent"> = Effect.Effect<
	ContractSuccess<"uploads", M>,
	AuthenticatedApiError
>;

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
const collection = Schema.decodeUnknownSync(CollectionResponse)({
	properties: {},
	providerId: null,
	externalId: null,
	name: "Favorites",
	id: "collection-1",
	entitySchemaSlug: "collection",
	createdAt: "2026-09-07T00:00:00.000Z",
	updatedAt: "2026-09-07T00:00:00.000Z",
});
const membership = Schema.decodeUnknownSync(MembershipResponse)({
	memberOf: {
		properties: {},
		id: "relationship-1",
		sourceEntityId: "entity-1",
		targetEntityId: "collection-1",
		relationshipSchemaSlug: "member-of",
		createdAt: "2026-09-07T00:00:00.000Z",
	},
});

const makeUploadsRuntime = (
	events: string[],
	steps: {
		readonly createIntent: UploadStep<"createIntent">;
		readonly completeIntent: UploadStep<"completeIntent">;
	},
) =>
	ManagedRuntime.make(
		Layer.mergeAll(
			makeCollectionsApi(),
			makeEntityInterestService(),
			makeRyotQLApi(),
			makeUploadsApi({
				createIntent: (_scope, request) => {
					events.push(`create-intent:${request.payload.fileName}`);
					return steps.createIntent;
				},
				completeIntent: (_scope, request) => {
					events.push(`complete-intent:${request.params.intentId}`);
					return steps.completeIntent;
				},
			}),
		),
	);

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
	it("routes semantic collection mutations through the scoped collections port", async () => {
		const calls: unknown[] = [];
		const runtime = ManagedRuntime.make(
			Layer.mergeAll(
				makeEntityInterestService(),
				makeRyotQLApi(),
				makeUploadsApi(),
				makeCollectionsApi({
					create: (receivedScope, request) => {
						calls.push({ method: "create", request, scope: receivedScope });
						return Effect.succeed(collection);
					},
					createMembership: (receivedScope, request) => {
						calls.push({ method: "createMembership", request, scope: receivedScope });
						return Effect.succeed(membership);
					},
					deleteMembership: (receivedScope, request) => {
						calls.push({ method: "deleteMembership", request, scope: receivedScope });
						return Effect.succeed(membership);
					},
				}),
			),
		);
		try {
			const client = createKernelRyotClient(runtime, scope, theme);
			await expect(client.collections.create({ name: "Favorites" })).resolves.toEqual(collection);
			await expect(
				client.collections.upsertMembership({
					entityId: "entity-1",
					collectionId: "collection-1",
				}),
			).resolves.toEqual(membership);
			await expect(
				client.collections.removeMembership({
					entityId: "entity-1",
					collectionId: "collection-1",
				}),
			).resolves.toEqual(membership);
			expect(calls).toEqual([
				{ method: "create", request: { payload: { name: "Favorites" } }, scope },
				{
					scope,
					method: "createMembership",
					request: { payload: { entityId: "entity-1", collectionId: "collection-1" } },
				},
				{
					scope,
					method: "deleteMembership",
					request: { payload: { entityId: "entity-1", collectionId: "collection-1" } },
				},
			]);
		} finally {
			await runtime.dispose();
		}
	});

	it("sanitizes declared and unexpected collection failures", async () => {
		await Promise.all(
			(
				[
					[
						new CollectionBadRequest({ reason: { code: "name-required", field: "name" } }),
						"collection-failed",
					],
					[new TypeError("private network detail"), "transport"],
				] as const
			).map(async ([failure, reason]) => {
				const runtime = ManagedRuntime.make(
					Layer.mergeAll(
						makeEntityInterestService(),
						makeRyotQLApi(),
						makeUploadsApi(),
						makeCollectionsApi({ create: () => fails(failure) }),
					),
				);
				try {
					const client = createKernelRyotClient(runtime, scope, theme);
					await expect(client.collections.create({ name: "Favorites" })).rejects.toMatchObject({
						reason,
					});
				} finally {
					await runtime.dispose();
				}
			}),
		);
	});

	it("reuses one client for equivalent API scopes and separates users", async () => {
		const runtime = makeRuntime(new Error("not used"));
		try {
			// This focused runtime provides the services used by the kernel client adapter.
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion
			const store = createKernelRyotClientStore(runtime as ClientRuntime, theme);
			const first = store.get(scope);
			expect(store.get({ ...scope })).toBe(first);
			expect(first.hostServices).toEqual({ runtime, scope });
			expect(store.get({ ...scope, userId: "user-2" })).not.toBe(first);
		} finally {
			await runtime.dispose();
		}
	});

	it("attaches synchronous watches by scope without acquiring a session for each client", async () => {
		const calls: unknown[] = [];
		const runtime = ManagedRuntime.make(
			Layer.mergeAll(
				makeCollectionsApi(),
				makeRyotQLApi(),
				makeUploadsApi(),
				makeEntityInterestService({
					acquire: () => {
						throw new Error("Client construction must not acquire a session");
					},
					watch: (receivedScope, interest, onUpdate) => {
						calls.push({ scope: receivedScope, interest });
						onUpdate({ entityId: "a", reason: "translated" });
						return {
							update: (next) => calls.push(next),
							dispose: () => {
								calls.push("disposed");
							},
						};
					},
				}),
			),
		);
		try {
			const first = createKernelRyotClient(runtime, scope, theme);
			const second = createKernelRyotClient(runtime, { ...scope }, theme);
			expect(calls).toEqual([]);
			const updates: unknown[] = [];
			const interest = { foreground: ["a"], visible: [] };
			const handle = first.entities.watch(interest, (update) => updates.push(update));
			second.entities.watch(interest, () => {});
			handle.update({ foreground: [], visible: ["b"] });
			handle.dispose();
			expect(calls).toEqual([
				{ scope, interest },
				{ scope, interest },
				{ foreground: [], visible: ["b"] },
				"disposed",
			]);
			expect(updates).toEqual([{ entityId: "a", reason: "translated" }]);
		} finally {
			await runtime.dispose();
		}
	});
	const managedAssets = [
		{ type: "local", key: "permanent/local.png" },
		{ type: "s3", key: "permanent/remote.png" },
	] as const;
	const managedAssetResolutions = [
		{
			asset: managedAssets[0],
			expiresAt: "2026-09-04T12:15:00.000Z",
			url: "https://ryot.example/api/uploads/local/download?key=permanent/local.png",
		},
		{
			asset: managedAssets[1],
			expiresAt: "2026-09-04T12:15:00.000Z",
			url: "https://s3.example/permanent/remote.png",
		},
	] as const;
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
			Layer.mergeAll(
				makeCollectionsApi(),
				makeEntityInterestService(),
				makeUploadsApi(),
				makeRyotQLApi({ execute: () => Effect.never }),
			),
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

	it("resolves managed assets through the authenticated upload port", async () => {
		const calls: Array<{ readonly scope: typeof scope; readonly request: unknown }> = [];
		const runtime = ManagedRuntime.make(
			Layer.mergeAll(
				makeCollectionsApi(),
				makeEntityInterestService(),
				makeRyotQLApi(),
				makeUploadsApi({
					resolveDownloads: (receivedScope, request) => {
						calls.push({ request, scope: receivedScope });
						return Effect.succeed(
							managedAssets.map((asset, index) => ({
								asset,
								expiresAt: managedAssetResolutions[index]?.expiresAt ?? "",
								downloadUrl:
									index === 0
										? "/uploads/local/download?key=permanent/local.png"
										: "https://s3.example/permanent/remote.png",
							})),
						);
					},
				}),
			),
		);
		try {
			const client = createKernelRyotClient(runtime, scope, theme);
			await expect(client.assets.resolve(managedAssets)).resolves.toEqual(managedAssetResolutions);
			expect(calls).toEqual([{ scope, request: { payload: { assets: [...managedAssets] } } }]);
		} finally {
			await runtime.dispose();
		}
	});

	it("passes the caller signal to authenticated asset resolution", async () => {
		const runtime = ManagedRuntime.make(
			Layer.mergeAll(
				makeCollectionsApi(),
				makeEntityInterestService(),
				makeUploadsApi({ resolveDownloads: () => Effect.never }),
				makeRyotQLApi(),
			),
		);
		const controller = new AbortController();
		const reason = new DOMException("Caller canceled", "AbortError");
		try {
			const client = createKernelRyotClient(runtime, scope, theme);
			const resolution = client.assets.resolve([{ type: "local", key: "permanent/local.png" }], {
				signal: controller.signal,
			});

			controller.abort(reason);

			await expect(resolution).rejects.toBe(reason);
		} finally {
			await runtime.dispose();
		}
	});

	for (const failure of [
		new AuthUnauthorized({ reason: { code: "authentication-required" } }),
		new AuthRateLimited({ reason: { code: "api-key-rate-limited", retryAfterMs: 30_000 } }),
		new UploadBadRequest({ reason: { code: "asset-forbidden" } }),
		new UploadInternalError({ reason: { code: "unexpected-error" } }),
	]) {
		it(`classifies ${failure._tag} as asset-failed`, async () => {
			const runtime = ManagedRuntime.make(
				Layer.mergeAll(
					makeCollectionsApi(),
					makeEntityInterestService(),
					makeRyotQLApi(),
					makeUploadsApi({ resolveDownloads: () => fails(failure) }),
				),
			);
			try {
				const client = createKernelRyotClient(runtime, scope, theme);
				await expect(
					client.assets.resolve([{ type: "local", key: "permanent/local.png" }]),
				).rejects.toMatchObject({ reason: "asset-failed" });
			} finally {
				await runtime.dispose();
			}
		});
	}

	it("classifies an unexpected asset failure as transport", async () => {
		const runtime = ManagedRuntime.make(
			Layer.mergeAll(
				makeCollectionsApi(),
				makeRyotQLApi(),
				makeEntityInterestService(),
				makeUploadsApi({ resolveDownloads: () => fails(new TypeError("private network detail")) }),
			),
		);
		try {
			const client = createKernelRyotClient(runtime, scope, theme);
			await expect(
				client.assets.resolve([{ type: "local", key: "permanent/local.png" }]),
			).rejects.toMatchObject({ reason: "transport" });
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
			createIntent: fails(
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
			createIntent: fails(new TypeError("private network detail")),
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
			completeIntent: fails(new UploadInternalError({ reason: { code: "unexpected-error" } })),
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
