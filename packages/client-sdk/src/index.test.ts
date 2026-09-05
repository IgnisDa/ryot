import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	createRyotClient,
	type EntityUpdate,
	type EntityInterest,
	RyotClientError,
	type ManagedAssetLocator,
	type RyotNavigationTarget,
	type TemporaryUploadRequest,
} from "./index";
import { createTestRyotAdapter } from "./testing";

const theme = { resolvedMode: "light" };
let notify: () => void = () => undefined;
const s3Asset = { type: "s3", key: "media/font.woff2" } as const;
const Greeting = Schema.Struct({ greeting: Schema.String });
const pluginSlug = "fixture";
const QueryResponse = Schema.Struct({ value: Schema.String });
const localAsset = { type: "local", key: "permanent/image.png" } as const;
const document = { output: {}, queries: {} } as PreparedRecipe<string>["document"];
const uploadToken = { token: "temporary-1", expiresAt: "2026-01-01T00:00:00.000Z" };
const assets: ManagedAssetLocator[] = [localAsset, s3Asset];
const resolutions = assets.map((asset) => ({
	asset,
	expiresAt: "2026-01-01T00:15:00.000Z",
	url: `https://ryot.test/api/uploads/${asset.type}/download?key=${encodeURIComponent(asset.key)}`,
}));
const membership = {
	warnings: [],
	memberOf: {
		properties: {},
		id: "relationship-1",
		sourceEntityId: "entity-1",
		targetEntityId: "collection-1",
		relationshipSchemaSlug: "member-of",
		createdAt: "2026-09-07T00:00:00.000Z",
	},
};

describe("createRyotClient", () => {
	it("validates and dispatches semantic collection membership methods", async () => {
		const requests: unknown[] = [];
		const client = createRyotClient(
			createTestRyotAdapter({
				mutateCollection: (request) => {
					requests.push(request);
					return Promise.resolve(membership);
				},
			}),
		);

		await expect(
			client.collections.upsertMembership({
				entityId: "entity-1",
				properties: { rank: 1 },
				collectionId: "collection-1",
			}),
		).resolves.toEqual(membership);
		expect(requests).toEqual([
			{
				action: "upsert-membership",
				input: { entityId: "entity-1", properties: { rank: 1 }, collectionId: "collection-1" },
			},
		]);
		await expect(
			Reflect.apply(client.collections.removeMembership, client.collections, [
				{ collectionId: "collection-1" },
			]),
		).rejects.toEqual(new RyotClientError("invalid-input"));
		expect(requests).toHaveLength(1);
	});

	it("validates collection results and reports a missing capability", async () => {
		const malformed = createRyotClient(
			createTestRyotAdapter({ mutateCollection: () => Promise.resolve({ memberOf: {} }) }),
		);
		await expect(
			malformed.collections.removeMembership({
				entityId: "entity-1",
				collectionId: "collection-1",
			}),
		).rejects.toEqual(new RyotClientError("malformed-result"));

		const unsupported = createRyotClient(createTestRyotAdapter());
		await expect(unsupported.collections.create({ name: "Favorites" })).rejects.toEqual(
			new RyotClientError("unsupported-capability"),
		);
	});

	it("signals only successful domain mutations at the capability boundary", async () => {
		let hints = 0;
		const client = createRyotClient(
			createTestRyotAdapter({
				invokeOperation: () => Promise.resolve({ greeting: "hello" }),
				mutateCollection: (request) =>
					request.action === "remove-membership"
						? Promise.reject(new RyotClientError("collection-failed"))
						: Promise.resolve(membership),
			}),
		);
		client.mutationCompleted.subscribe(() => hints++);

		await client.operations.invoke({ input: {}, pluginSlug, slug: "greet", output: Greeting });
		await client.collections.upsertMembership({
			entityId: "entity-1",
			collectionId: "collection-1",
		});
		await expect(
			client.collections.removeMembership({ entityId: "entity-1", collectionId: "collection-1" }),
		).rejects.toEqual(new RyotClientError("collection-failed"));
		await client.uploads.uploadTemporary({
			fileName: "value.txt",
			contentType: "text/plain",
			source: new Blob(["value"]),
		});

		expect(hints).toBe(2);
	});
	it("normalizes mutable entity watches without capping declarations and disposes once", () => {
		let disposals = 0;
		const interests: EntityInterest[] = [];
		const updates: EntityInterest[] = [];
		const events: EntityUpdate[] = [];
		const onUpdate = (event: EntityUpdate) => {
			events.push(event);
		};
		let notifyEntity!: (event: EntityUpdate) => void;
		const watchEntities = (interest: EntityInterest, listener: typeof notifyEntity) => {
			interests.push(interest);
			notifyEntity = listener;
			return {
				dispose: () => {
					disposals++;
				},
				update: (next: EntityInterest) => {
					updates.push(next);
				},
			};
		};
		const client = createRyotClient(
			createTestRyotAdapter({ watchEntities, query: () => Promise.resolve({}) }),
		);
		const subscription = client.entities.watch(
			{ visible: ["c", "a", "c"], foreground: ["b", "a", "a"] },
			onUpdate,
		);
		expect(interests).toEqual([{ visible: ["c"], foreground: ["a", "b"] }]);
		const rows = Array.from({ length: 600 }, (_, i) => `row-${i}`);
		subscription.update({ visible: rows, foreground: [] });
		expect(updates[0]?.visible).toHaveLength(600);
		notifyEntity({ entityId: "a", reason: "populated" });
		expect(events).toEqual([{ entityId: "a", reason: "populated" }]);
		subscription.dispose();
		subscription.dispose();
		notifyEntity({ entityId: "a", reason: "translated" });
		expect(disposals).toBe(1);
		expect(events).toHaveLength(1);
		expect(() => subscription.update({ visible: [], foreground: [] })).toThrow(
			new RyotClientError("disposed"),
		);
	});

	it("reports synchronous entity capability, input, and transport failures", () => {
		const client = createRyotClient(createTestRyotAdapter({ query: () => Promise.resolve({}) }));
		expect(() => client.entities.watch({ visible: [], foreground: [] }, () => undefined)).toThrow(
			new RyotClientError("unsupported-capability"),
		);
		expect(() =>
			Reflect.apply(client.entities.watch, undefined, [
				{ visible: [], foreground: [123] },
				() => undefined,
			]),
		).toThrow(new RyotClientError("invalid-input"));
		const offline = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.resolve({}),
				watchEntities: () => {
					throw new Error("offline");
				},
			}),
		);
		expect(() => offline.entities.watch({ visible: [], foreground: [] }, () => undefined)).toThrow(
			new RyotClientError("transport"),
		);
	});

	it("sends only a recipe document and decodes the response locally", async () => {
		const query = (received: typeof document) => {
			expect(received).toBe(document);
			return Promise.resolve({ value: "decoded" });
		};
		const client = createRyotClient(
			createTestRyotAdapter({ query, invokeOperation: () => Promise.resolve({}) }),
		);
		const recipe: PreparedRecipe<string> = {
			document,
			decode: (response) =>
				Result.map(Schema.decodeUnknownResult(QueryResponse)(response), ({ value }) => value),
		};
		await expect(client.data.query(recipe)).resolves.toBe("decoded");
	});

	it("forwards query cancellation and preserves the caller abort reason", async () => {
		const controller = new AbortController();
		const reason = new DOMException("Caller canceled", "AbortError");
		let receivedSignal: AbortSignal | undefined;
		const client = createRyotClient(
			createTestRyotAdapter({
				query: (_document, signal) => {
					receivedSignal = signal;
					return new Promise((_resolve, reject) =>
						signal?.addEventListener("abort", () => reject(signal.reason), { once: true }),
					);
				},
			}),
		);
		const recipe: PreparedRecipe<string> = { document, decode: () => Result.succeed("unused") };
		const query = client.data.query(recipe, { signal: controller.signal });

		controller.abort(reason);

		expect(receivedSignal).toBe(controller.signal);
		await expect(query).rejects.toBe(reason);
	});

	it("does not call the adapter for an already canceled query", async () => {
		const controller = new AbortController();
		const reason = new DOMException("Caller canceled", "AbortError");
		let calls = 0;
		controller.abort(reason);
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => {
					calls += 1;
					return Promise.resolve({});
				},
			}),
		);

		await expect(
			client.data.query({ document, decode: Result.succeed }, { signal: controller.signal }),
		).rejects.toBe(reason);
		expect(calls).toBe(0);
	});

	it("rejects malformed query and operation results with stable reasons", async () => {
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.resolve({}),
				invokeOperation: () => Promise.resolve({ greeting: 42 }),
			}),
		);
		const recipe: PreparedRecipe<string> = { document, decode: () => Result.fail("invalid") };
		await expect(client.data.query(recipe)).rejects.toMatchObject({ reason: "malformed-result" });
		await expect(client.data.query(recipe)).rejects.toBeInstanceOf(RyotClientError);
		const invocation = { input: {}, pluginSlug, slug: "greet", output: Greeting };
		await expect(client.operations.invoke(invocation)).rejects.toMatchObject({
			reason: "malformed-result",
		});
		await expect(client.operations.invoke(invocation)).rejects.toBeInstanceOf(RyotClientError);
	});

	it("forwards the explicit plugin operation target", async () => {
		const requests: unknown[] = [];
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.resolve({}),
				invokeOperation: (request) => {
					requests.push(request);
					return Promise.resolve({ greeting: "hello" });
				},
			}),
		);

		await expect(
			client.operations.invoke({ input: {}, pluginSlug, slug: "greet", output: Greeting }),
		).resolves.toEqual({ greeting: "hello" });
		expect(requests).toEqual([{ input: {}, slug: "greet", pluginSlug: "fixture" }]);
	});

	it("classifies a thrown recipe decoder as a malformed result", async () => {
		const client = createRyotClient(createTestRyotAdapter({ query: () => Promise.resolve({}) }));
		const recipe: PreparedRecipe<string> = {
			document,
			decode: () => {
				throw new Error("decoder detail");
			},
		};

		await expect(client.data.query(recipe)).rejects.toEqual(
			new RyotClientError("malformed-result"),
		);
	});

	it("rejects non-JSON adapter output before applying its output schema", async () => {
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.resolve({}),
				invokeOperation: () => Promise.resolve(undefined),
			}),
		);

		await expect(
			client.operations.invoke({
				pluginSlug,
				input: null,
				slug: "greet",
				output: Schema.Undefined,
			}),
		).rejects.toMatchObject({ reason: "malformed-result" });
	});

	it("normalizes unexpected adapter failures as transport errors", async () => {
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.reject(new Error("network details")),
				invokeOperation: () => Promise.reject(new Error("network details")),
			}),
		);
		const recipe: PreparedRecipe<string> = { document, decode: () => Result.succeed("unused") };
		await expect(client.data.query(recipe)).rejects.toMatchObject({ reason: "transport" });
		await expect(
			client.operations.invoke({ input: {}, pluginSlug, slug: "greet", output: Greeting }),
		).rejects.toMatchObject({ reason: "transport" });
	});

	it("preserves canonical client errors from adapters", async () => {
		const error = new RyotClientError("protocol");
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.reject(error),
				invokeOperation: () => Promise.reject(error),
			}),
		);
		const recipe: PreparedRecipe<string> = { document, decode: () => Result.succeed("unused") };

		await expect(client.data.query(recipe)).rejects.toBe(error);
		await expect(
			client.operations.invoke({ input: {}, pluginSlug, slug: "greet", output: Greeting }),
		).rejects.toBe(error);
	});

	it("rejects invalid JSON input before consulting the adapter", async () => {
		let calls = 0;
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.resolve({}),
				invokeOperation: () => {
					calls += 1;
					return Promise.resolve({ greeting: "unused" });
				},
			}),
		);

		await expect(
			Reflect.apply(client.operations.invoke, client.operations, [
				{ pluginSlug, slug: "greet", output: Greeting, input: { invalid: undefined } },
			]),
		).rejects.toMatchObject({ reason: "invalid-input" });
		expect(calls).toBe(0);
	});

	it("rejects operations when the environment does not provide that capability", async () => {
		const client = createRyotClient(createTestRyotAdapter({ query: () => Promise.resolve({}) }));

		expect(client.data).not.toHaveProperty("invokeOperation");
		await expect(
			client.operations.invoke({ input: {}, pluginSlug, slug: "greet", output: Greeting }),
		).rejects.toMatchObject({ reason: "unsupported-capability" });
	});

	it("hides the upload transfer behind a single call and decodes the token", async () => {
		const requests: TemporaryUploadRequest[] = [];
		const source = new Blob(["id,title"], { type: "text/csv" });
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.resolve({}),
				uploadTemporary: (request) => {
					requests.push(request);
					return Promise.resolve(uploadToken);
				},
			}),
		);

		const request = { source, fileName: "items.csv", contentType: "text/csv" };
		await expect(client.uploads.uploadTemporary(request)).resolves.toEqual(uploadToken);
		expect(requests).toEqual([request]);
	});

	it("rejects a non-Blob upload source before reaching the adapter", async () => {
		let calls = 0;
		const client = createRyotClient(
			createTestRyotAdapter({
				uploadTemporary: () => {
					calls += 1;
					return Promise.resolve(uploadToken);
				},
			}),
		);

		await expect(
			Reflect.apply(client.uploads.uploadTemporary, client.uploads, [
				{ source: "id,title", fileName: "items.csv", contentType: "text/csv" },
			]),
		).rejects.toMatchObject({ reason: "invalid-input" });
		expect(calls).toBe(0);
	});

	it("rejects an upload result that is not a temporary upload token", async () => {
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.resolve({}),
				uploadTemporary: () => Promise.resolve({ type: "local", key: "assets/items.csv" }),
			}),
		);

		await expect(
			client.uploads.uploadTemporary({
				fileName: "items.csv",
				contentType: "text/csv",
				source: new Blob(["id,title"]),
			}),
		).rejects.toEqual(new RyotClientError("malformed-result"));
	});

	it("delegates one managed asset batch and decodes its resolutions", async () => {
		const requests: Array<readonly ManagedAssetLocator[]> = [];
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.resolve({}),
				resolveAssets: (request) => {
					requests.push(request);
					return Promise.resolve(resolutions);
				},
			}),
		);

		await expect(client.assets.resolve(assets)).resolves.toEqual(resolutions);
		expect(requests).toEqual([assets]);
	});

	it("rejects empty and non-managed asset input before consulting the adapter", async () => {
		let calls = 0;
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.resolve({}),
				resolveAssets: () => {
					calls += 1;
					return Promise.resolve([]);
				},
			}),
		);

		await Promise.all(
			[
				[],
				[{ type: "remote", url: "https://example.com/image.png" }],
				Array.from({ length: 65 }, (_, index) => ({
					type: "local",
					key: `permanent/${index}.png`,
				})),
			].map((input) =>
				expect(Reflect.apply(client.assets.resolve, client.assets, [input])).rejects.toMatchObject({
					reason: "invalid-input",
				}),
			),
		);
		expect(calls).toBe(0);
	});

	it("forwards asset cancellation and preserves the caller abort reason", async () => {
		const controller = new AbortController();
		const reason = new DOMException("Caller canceled", "AbortError");
		let receivedSignal: AbortSignal | undefined;
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.resolve({}),
				resolveAssets: (_assets, signal) => {
					receivedSignal = signal;
					return new Promise((_resolve, reject) =>
						signal?.addEventListener("abort", () => reject(signal.reason), { once: true }),
					);
				},
			}),
		);
		const resolution = client.assets.resolve(assets, { signal: controller.signal });

		controller.abort(reason);

		expect(receivedSignal).toBe(controller.signal);
		await expect(resolution).rejects.toBe(reason);
	});

	it("does not call the adapter for an already canceled asset request", async () => {
		const controller = new AbortController();
		const reason = new DOMException("Caller canceled", "AbortError");
		let calls = 0;
		controller.abort(reason);
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.resolve({}),
				resolveAssets: () => {
					calls += 1;
					return Promise.resolve(resolutions);
				},
			}),
		);

		await expect(client.assets.resolve(assets, { signal: controller.signal })).rejects.toBe(reason);
		expect(calls).toBe(0);
	});

	it("rejects asset resolution when the environment does not provide that capability", async () => {
		const client = createRyotClient(createTestRyotAdapter({ query: () => Promise.resolve({}) }));

		await expect(client.assets.resolve(assets)).rejects.toMatchObject({
			reason: "unsupported-capability",
		});
	});

	it("rejects malformed asset expiry, locators, and result batches", async () => {
		let response: unknown = [{ ...resolutions[0], expiresAt: "not-a-date" }];
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.resolve({}),
				resolveAssets: () => Promise.resolve(response),
			}),
		);

		await expect(client.assets.resolve([localAsset])).rejects.toEqual(
			new RyotClientError("malformed-result"),
		);
		response = [{ ...resolutions[0], asset: { type: "local", key: "other.png" } }];
		await expect(client.assets.resolve([localAsset])).rejects.toEqual(
			new RyotClientError("malformed-result"),
		);
		response = [resolutions[0]];
		await expect(client.assets.resolve(assets)).rejects.toEqual(
			new RyotClientError("malformed-result"),
		);
	});

	it("preserves a canonical asset-failed error from the adapter", async () => {
		const error = new RyotClientError("asset-failed");
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.resolve({}),
				resolveAssets: () => Promise.reject(error),
			}),
		);

		await expect(client.assets.resolve(assets)).rejects.toBe(error);
	});

	it("delegates navigation through the adapter", () => {
		const navigations: Array<{
			readonly mode: "push" | "replace";
			readonly target: RyotNavigationTarget;
		}> = [];
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.resolve({}),
				navigate: (mode, target) => navigations.push({ mode, target }),
			}),
		);

		client.navigation.push({
			pluginSlug,
			path: "/items",
			kind: "plugin-route",
			search: { tab: "stats" },
		});
		client.navigation.replace({ kind: "entity", entityId: "entity-1" });
		client.navigation.push({ kind: "saved-view", savedViewId: "view-1" });

		expect(navigations).toEqual([
			{
				mode: "push",
				target: { pluginSlug, path: "/items", kind: "plugin-route", search: { tab: "stats" } },
			},
			{ mode: "replace", target: { kind: "entity", entityId: "entity-1" } },
			{ mode: "push", target: { kind: "saved-view", savedViewId: "view-1" } },
		]);
	});

	it("delegates merged page-search updates without rewriting unrelated keys", () => {
		const updates: Array<{
			readonly mode: "push" | "replace";
			readonly update: Readonly<Record<string, string | null>>;
		}> = [];
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.resolve({}),
				navigatePageSearch: (mode, update) => updates.push({ mode, update }),
			}),
		);

		client.navigation.pageSearch.push({ entityId: "entity-1", dialog: "add-to-collection" });
		client.navigation.pageSearch.replace({ dialog: null, entityId: null });

		expect(updates).toEqual([
			{ mode: "push", update: { entityId: "entity-1", dialog: "add-to-collection" } },
			{ mode: "replace", update: { dialog: null, entityId: null } },
		]);
	});

	it("validates and delegates semantic provider-search screen requests", () => {
		const requests: unknown[] = [];
		const client = createRyotClient(
			createTestRyotAdapter({ openProviderSearch: (request) => requests.push(request) }),
		);

		client.screens.openProviderSearch({
			initialQuery: "Dune",
			entitySchemaSlug: "movie",
			ownerPluginId: "media-installation",
		});
		expect(requests).toEqual([
			{ initialQuery: "Dune", entitySchemaSlug: "movie", ownerPluginId: "media-installation" },
		]);
		expect(() =>
			Reflect.apply(client.screens.openProviderSearch, undefined, [
				{ ownerPluginId: "", entitySchemaSlug: "movie" },
			]),
		).toThrow(new RyotClientError("invalid-input"));
	});

	it("rejects navigation when the environment does not provide that capability", () => {
		const client = createRyotClient(createTestRyotAdapter({ query: () => Promise.resolve({}) }));

		expect(() =>
			client.navigation.push({ pluginSlug, path: "/items", kind: "plugin-route" }),
		).toThrow(new RyotClientError("unsupported-capability"));
	});

	it("normalizes unexpected navigation failures as transport errors", () => {
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.resolve({}),
				navigate: () => {
					throw new Error("transport detail");
				},
			}),
		);

		expect(() =>
			client.navigation.push({ pluginSlug, path: "/items", kind: "plugin-route" }),
		).toThrow(new RyotClientError("transport"));
	});

	it("decodes theme snapshots and delegates reactive subscriptions", () => {
		let notifications = 0;
		let current: unknown = theme;
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.resolve({}),
				theme: {
					getSnapshot: () => current,
					subscribe: (listener) => {
						notify = listener;
						return () => {
							notify = () => undefined;
						};
					},
				},
			}),
		);

		const initial = client.theme.getSnapshot();
		expect(initial).toEqual(theme);
		expect(client.theme.getSnapshot()).toBe(initial);
		const unsubscribe = client.theme.subscribe(() => {
			notifications += 1;
		});
		current = { resolvedMode: "dark" };
		notify();
		expect(notifications).toBe(1);
		expect(client.theme.getSnapshot()).toEqual(current);
		current = { resolvedMode: "system" };
		expect(() => notify()).toThrow(new RyotClientError("malformed-result"));
		expect(notifications).toBe(1);
		unsubscribe();
		notify();
		expect(notifications).toBe(1);
	});

	it("rejects missing and malformed theme adapters with shared errors", () => {
		const unsupported = createRyotClient(
			createTestRyotAdapter({ query: () => Promise.resolve({}) }),
		);
		const malformed = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.resolve({}),
				theme: { subscribe: () => () => {}, getSnapshot: () => ({ resolvedMode: "system" }) },
			}),
		);

		expect(() => unsupported.theme.getSnapshot()).toThrow(
			new RyotClientError("unsupported-capability"),
		);
		expect(() => unsupported.theme.subscribe(() => undefined)).toThrow(
			new RyotClientError("unsupported-capability"),
		);
		expect(() => malformed.theme.getSnapshot()).toThrow(new RyotClientError("malformed-result"));
	});
});
