import { describe, expect, it } from "@effect/vitest";
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
const document = { output: {}, queries: {} } as PreparedRecipe<unknown>["document"];
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

const intent: UploadIntentResponse = {
	method: "PUT",
	intentId: "intent-1",
	uploadUrl: "/uploads/local/intent-1",
	expiresAt: "2026-01-01T00:00:00.000Z",
	headers: { "content-type": "text/csv", "x-upload-signature": "signed" },
};

const uploadToken = { token: "temporary-1", expiresAt: "2026-01-01T00:00:00.000Z" };
const collection = Schema.decodeSync(CollectionResponse)({
	warnings: [],
	properties: {},
	providerId: null,
	externalId: null,
	name: "Favorites",
	id: "collection-1",
	entitySchemaSlug: "collection",
	createdAt: "2026-09-07T00:00:00.000Z",
	updatedAt: "2026-09-07T00:00:00.000Z",
});
const membership = Schema.decodeSync(MembershipResponse)({
	warnings: [],
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
		readonly putBytes?: Effect.Effect<void, AuthenticatedApiError>;
	},
) =>
	ManagedRuntime.make(
		Layer.mergeAll(
			makeCollectionsApi(),
			makeEntityInterestService(),
			makeRyotQLApi(),
			makeUploadsApi({
				putBytes: (_scope, transfer) => {
					events.push(`put:${transfer.uploadUrl}`);
					return steps.putBytes ?? Effect.void;
				},
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

const source = new Blob(["id,title"], { type: "text/csv" });
const uploadRequest = { source, fileName: "items.csv", contentType: "text/csv" };

describe("kernel Ryot client", () => {
	it.live("routes semantic collection mutations through the scoped collections port", () => {
		const calls: unknown[] = [];
		const runtime = ManagedRuntime.make(
			Layer.mergeAll(
				makeEntityInterestService(),
				makeRyotQLApi(),
				makeUploadsApi(),
				makeCollectionsApi({
					create: (receivedScope, request) => {
						calls.push({ request, method: "create", scope: receivedScope });
						return Effect.succeed(collection);
					},
					createMembership: (receivedScope, request) => {
						calls.push({ request, scope: receivedScope, method: "createMembership" });
						return Effect.succeed(membership);
					},
					deleteMembership: (receivedScope, request) => {
						calls.push({ request, scope: receivedScope, method: "deleteMembership" });
						return Effect.succeed(membership);
					},
				}),
			),
		);
		return Effect.gen(function* () {
			const client = createKernelRyotClient(runtime, scope, theme);
			expect(yield* client.collections.create({ name: "Favorites" })).toEqual(collection);
			expect(
				yield* client.collections.upsertMembership({
					entityId: "entity-1",
					collectionId: "collection-1",
				}),
			).toEqual(membership);
			expect(
				yield* client.collections.removeMembership({
					entityId: "entity-1",
					collectionId: "collection-1",
				}),
			).toEqual(membership);
			expect(calls).toEqual([
				{ scope, method: "create", request: { payload: { name: "Favorites" } } },
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
		}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});

	it.live("sanitizes declared and unexpected collection failures", () =>
		Effect.gen(function* () {
			for (const [failure, reason] of [
				[
					new CollectionBadRequest({ reason: { field: "name", code: "name-required" } }),
					"collection-failed",
				],
				[new TypeError("private network detail"), "transport"],
			] as const) {
				const runtime = ManagedRuntime.make(
					Layer.mergeAll(
						makeEntityInterestService(),
						makeRyotQLApi(),
						makeUploadsApi(),
						makeCollectionsApi({ create: () => fails(failure) }),
					),
				);
				const client = createKernelRyotClient(runtime, scope, theme);
				const result = yield* Effect.result(client.collections.create({ name: "Favorites" })).pipe(
					Effect.ensuring(Effect.promise(() => runtime.dispose())),
				);
				expect(result).toMatchObject({ failure: { reason } });
			}
		}),
	);

	it.live("reuses one client for equivalent API scopes and separates users", () => {
		const runtime = makeRuntime(new Error("not used"));
		return Effect.sync(() => {
			// This focused runtime provides the services used by the kernel client adapter.
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion
			const store = createKernelRyotClientStore(runtime as ClientRuntime, theme);
			const first = store.get(scope);
			expect(store.get({ ...scope })).toBe(first);
			expect(first.hostServices).toEqual({ scope, runtime });
			expect(store.get({ ...scope, userId: "user-2" })).not.toBe(first);
		}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});

	it.live(
		"attaches synchronous watches by scope without acquiring a session for each client",
		() => {
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
							calls.push({ interest, scope: receivedScope });
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
			return Effect.sync(() => {
				const first = createKernelRyotClient(runtime, scope, theme);
				const second = createKernelRyotClient(runtime, { ...scope }, theme);
				expect(calls).toEqual([]);
				const updates: unknown[] = [];
				const interest = { visible: [], foreground: ["a"] };
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
			}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
		},
	);
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
		new AuthRateLimited({ reason: { retryAfterMs: 30_000, code: "api-key-rate-limited" } }),
		new RyotQLBadRequest({ reason: { code: "invalid-query" } }),
		new RyotQLInternalError({ reason: { code: "execution-failed" } }),
	];

	for (const failure of declaredFailures) {
		it.live(`classifies ${failure._tag} as query-failed`, () => {
			const runtime = makeRuntime(failure);
			const client = createKernelRyotClient(runtime, scope, theme);
			const query = Effect.runPromise(client.data.query(recipe));
			return Effect.promise(() =>
				expect(query).rejects.toMatchObject({ reason: "query-failed" }),
			).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
		});
	}

	it.live("classifies an unexpected failure as transport", () => {
		const runtime = makeRuntime(new TypeError("private network detail"));
		const client = createKernelRyotClient(runtime, scope, theme);
		const query = Effect.runPromise(client.data.query(recipe));
		return Effect.promise(() => expect(query).rejects.toMatchObject({ reason: "transport" })).pipe(
			Effect.ensuring(Effect.promise(() => runtime.dispose())),
		);
	});

	it.live("interrupts a query with the caller signal", () => {
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
		const client = createKernelRyotClient(runtime, scope, theme);
		const query = Effect.runPromise(client.data.query(recipe), { signal: controller.signal });

		controller.abort(reason);

		return Effect.promise(() => expect(query).rejects.toThrow(/interrupted/)).pipe(
			Effect.ensuring(Effect.promise(() => runtime.dispose())),
		);
	});

	it.live("resolves managed assets through the authenticated upload port", () => {
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
		return Effect.gen(function* () {
			const client = createKernelRyotClient(runtime, scope, theme);
			expect(yield* client.assets.resolve(managedAssets)).toEqual(managedAssetResolutions);
			expect(calls).toEqual([{ scope, request: { payload: { assets: [...managedAssets] } } }]);
		}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});

	it.live("interrupts authenticated asset resolution on cancellation", () => {
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
		const client = createKernelRyotClient(runtime, scope, theme);
		const resolution = Effect.runPromise(
			client.assets.resolve([{ type: "local", key: "permanent/local.png" }]),
			{ signal: controller.signal },
		);

		controller.abort(reason);

		return Effect.promise(() => expect(resolution).rejects.toThrow(/interrupted/)).pipe(
			Effect.ensuring(Effect.promise(() => runtime.dispose())),
		);
	});

	for (const failure of [
		new AuthUnauthorized({ reason: { code: "authentication-required" } }),
		new AuthRateLimited({ reason: { retryAfterMs: 30_000, code: "api-key-rate-limited" } }),
		new UploadBadRequest({ reason: { code: "asset-forbidden" } }),
		new UploadInternalError({ reason: { code: "unexpected-error" } }),
	]) {
		it.live(`classifies ${failure._tag} as asset-failed`, () => {
			const runtime = ManagedRuntime.make(
				Layer.mergeAll(
					makeCollectionsApi(),
					makeEntityInterestService(),
					makeRyotQLApi(),
					makeUploadsApi({ resolveDownloads: () => fails(failure) }),
				),
			);
			return Effect.gen(function* () {
				const client = createKernelRyotClient(runtime, scope, theme);
				expect(
					yield* Effect.flip(
						client.assets.resolve([{ type: "local", key: "permanent/local.png" }]),
					),
				).toMatchObject({ reason: "asset-failed" });
			}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
		});
	}

	it.live("classifies an unexpected asset failure as transport", () => {
		const runtime = ManagedRuntime.make(
			Layer.mergeAll(
				makeCollectionsApi(),
				makeRyotQLApi(),
				makeEntityInterestService(),
				makeUploadsApi({ resolveDownloads: () => fails(new TypeError("private network detail")) }),
			),
		);
		return Effect.gen(function* () {
			const client = createKernelRyotClient(runtime, scope, theme);
			expect(
				yield* Effect.flip(client.assets.resolve([{ type: "local", key: "permanent/local.png" }])),
			).toMatchObject({ reason: "transport" });
		}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});
});

describe("kernel temporary uploads", () => {
	it.live("creates an intent, transfers the bytes with its headers, then completes it", () => {
		const events: string[] = [];
		const transfers: unknown[] = [];
		const runtime = ManagedRuntime.make(
			Layer.mergeAll(
				makeCollectionsApi(),
				makeEntityInterestService(),
				makeRyotQLApi(),
				makeUploadsApi({
					createIntent: (_scope, request) => {
						events.push(`create-intent:${request.payload.fileName}`);
						return Effect.succeed(intent);
					},
					putBytes: (_scope, transfer) => {
						events.push(`put:${transfer.uploadUrl}`);
						transfers.push(transfer);
						return Effect.void;
					},
					completeIntent: (_scope, request) => {
						events.push(`complete-intent:${request.params.intentId}`);
						return Effect.succeed(uploadToken);
					},
				}),
			),
		);
		return Effect.gen(function* () {
			const client = createKernelRyotClient(runtime, scope, theme);
			expect(yield* client.uploads.uploadTemporary(uploadRequest)).toEqual(uploadToken);

			expect(events).toEqual([
				"create-intent:items.csv",
				"put:/uploads/local/intent-1",
				"complete-intent:intent-1",
			]);
			expect(transfers).toEqual([
				{
					source,
					contentType: "text/csv",
					headers: { ...intent.headers },
					uploadUrl: "/uploads/local/intent-1",
				},
			]);
		}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});

	it.live("classifies a declared intent failure as operation-failed and skips the transfer", () => {
		const events: string[] = [];
		const runtime = makeUploadsRuntime(events, {
			completeIntent: Effect.succeed(uploadToken),
			createIntent: fails(
				new UploadBadRequest({
					reason: { contentType: "text/csv", code: "unsupported-file-type" },
				}),
			),
		});
		return Effect.gen(function* () {
			const client = createKernelRyotClient(runtime, scope, theme);
			expect(yield* Effect.flip(client.uploads.uploadTemporary(uploadRequest))).toMatchObject({
				reason: "operation-failed",
			});

			expect(events).toEqual(["create-intent:items.csv"]);
		}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});

	it.live("classifies an unexpected intent failure as transport", () => {
		const events: string[] = [];
		const runtime = makeUploadsRuntime(events, {
			completeIntent: Effect.succeed(uploadToken),
			createIntent: fails(new TypeError("private network detail")),
		});
		return Effect.gen(function* () {
			const client = createKernelRyotClient(runtime, scope, theme);
			expect(yield* Effect.flip(client.uploads.uploadTemporary(uploadRequest))).toMatchObject({
				reason: "transport",
			});
		}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});

	it.live("classifies a rejected byte transfer and never completes the intent", () =>
		Effect.gen(function* () {
			const rejected: string[] = [];
			const rejectedRuntime = makeUploadsRuntime(rejected, {
				putBytes: fails(403),
				createIntent: Effect.succeed(intent),
				completeIntent: Effect.succeed(uploadToken),
			});
			yield* Effect.gen(function* () {
				const client = createKernelRyotClient(rejectedRuntime, scope, theme);
				expect(yield* Effect.flip(client.uploads.uploadTemporary(uploadRequest))).toMatchObject({
					reason: "operation-failed",
				});
				expect(rejected).toEqual(["create-intent:items.csv", "put:/uploads/local/intent-1"]);
			}).pipe(Effect.ensuring(Effect.promise(() => rejectedRuntime.dispose())));

			const offline: string[] = [];
			const offlineRuntime = makeUploadsRuntime(offline, {
				createIntent: Effect.succeed(intent),
				completeIntent: Effect.succeed(uploadToken),
				putBytes: fails(new TypeError("Failed to fetch")),
			});
			yield* Effect.gen(function* () {
				const client = createKernelRyotClient(offlineRuntime, scope, theme);
				expect(yield* Effect.flip(client.uploads.uploadTemporary(uploadRequest))).toMatchObject({
					reason: "transport",
				});
				expect(offline).toEqual(["create-intent:items.csv", "put:/uploads/local/intent-1"]);
			}).pipe(Effect.ensuring(Effect.promise(() => offlineRuntime.dispose())));
		}),
	);

	it.live("classifies a failed completion after the bytes are transferred", () => {
		const events: string[] = [];
		const runtime = makeUploadsRuntime(events, {
			createIntent: Effect.succeed(intent),
			completeIntent: fails(new UploadInternalError({ reason: { code: "unexpected-error" } })),
		});
		return Effect.gen(function* () {
			const client = createKernelRyotClient(runtime, scope, theme);
			expect(yield* Effect.flip(client.uploads.uploadTemporary(uploadRequest))).toMatchObject({
				reason: "operation-failed",
			});

			expect(events).toEqual([
				"create-intent:items.csv",
				"put:/uploads/local/intent-1",
				"complete-intent:intent-1",
			]);
		}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});

	it.live("rejects a completion that resolves to a managed asset instead of a token", () => {
		const events: string[] = [];
		const runtime = makeUploadsRuntime(events, {
			createIntent: Effect.succeed(intent),
			completeIntent: Effect.succeed({ type: "local", key: "assets/items.csv" }),
		});
		return Effect.gen(function* () {
			const client = createKernelRyotClient(runtime, scope, theme);
			expect(yield* Effect.flip(client.uploads.uploadTemporary(uploadRequest))).toMatchObject({
				reason: "malformed-result",
			});
			expect(events).toEqual([
				"create-intent:items.csv",
				"put:/uploads/local/intent-1",
				"complete-intent:intent-1",
			]);
		}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});
});
