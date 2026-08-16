import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	createRyotClient,
	RyotClientError,
	type ManagedAssetLocator,
	type RyotNavigationTarget,
	type TemporaryUploadRequest,
} from "./index";

const theme = { resolvedMode: "light" };
let notify: () => void = () => undefined;
const s3Asset = { key: "media/font.woff2", type: "s3" } as const;
const Greeting = Schema.Struct({ greeting: Schema.String });
const QueryResponse = Schema.Struct({ value: Schema.String });
const localAsset = { key: "permanent/image.png", type: "local" } as const;
const document = { queries: {}, output: {} } as PreparedRecipe<string>["document"];
const uploadToken = { token: "temporary-1", expiresAt: "2026-01-01T00:00:00.000Z" };
const assets: ManagedAssetLocator[] = [localAsset, s3Asset];
const resolutions = assets.map((asset) => ({
	asset,
	expiresAt: "2026-01-01T00:15:00.000Z",
	url: `https://ryot.test/api/uploads/${asset.type}/download?key=${encodeURIComponent(asset.key)}`,
}));

describe("createRyotClient", () => {
	it("sends only a recipe document and decodes the response locally", async () => {
		const query = (received: typeof document) => {
			expect(received).toBe(document);
			return Promise.resolve({ value: "decoded" });
		};
		const client = createRyotClient({ query, invokeOperation: () => Promise.resolve({}) });
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
		const client = createRyotClient({
			query: (_document, signal) => {
				receivedSignal = signal;
				return new Promise((_resolve, reject) =>
					signal?.addEventListener("abort", () => reject(signal.reason), { once: true }),
				);
			},
		});
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
		const client = createRyotClient({
			query: () => {
				calls += 1;
				return Promise.resolve({});
			},
		});

		await expect(
			client.data.query({ document, decode: Result.succeed }, { signal: controller.signal }),
		).rejects.toBe(reason);
		expect(calls).toBe(0);
	});

	it("rejects malformed query and operation results with stable reasons", async () => {
		const client = createRyotClient({
			query: () => Promise.resolve({}),
			invokeOperation: () => Promise.resolve({ greeting: 42 }),
		});
		const recipe: PreparedRecipe<string> = { document, decode: () => Result.fail("invalid") };
		await expect(client.data.query(recipe)).rejects.toMatchObject({ reason: "malformed-result" });
		await expect(client.data.query(recipe)).rejects.toBeInstanceOf(RyotClientError);
		const invocation = { slug: "greet", input: {}, output: Greeting };
		await expect(client.operations.invoke(invocation)).rejects.toMatchObject({
			reason: "malformed-result",
		});
		await expect(client.operations.invoke(invocation)).rejects.toBeInstanceOf(RyotClientError);
	});

	it("classifies a thrown recipe decoder as a malformed result", async () => {
		const client = createRyotClient({ query: () => Promise.resolve({}) });
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
		const client = createRyotClient({
			query: () => Promise.resolve({}),
			invokeOperation: () => Promise.resolve(undefined),
		});

		await expect(
			client.operations.invoke({ slug: "greet", input: null, output: Schema.Undefined }),
		).rejects.toMatchObject({ reason: "malformed-result" });
	});

	it("normalizes unexpected adapter failures as transport errors", async () => {
		const client = createRyotClient({
			query: () => Promise.reject(new Error("network details")),
			invokeOperation: () => Promise.reject(new Error("network details")),
		});
		const recipe: PreparedRecipe<string> = { document, decode: () => Result.succeed("unused") };
		await expect(client.data.query(recipe)).rejects.toMatchObject({ reason: "transport" });
		await expect(
			client.operations.invoke({ slug: "greet", input: {}, output: Greeting }),
		).rejects.toMatchObject({ reason: "transport" });
	});

	it("preserves canonical client errors from adapters", async () => {
		const error = new RyotClientError("protocol");
		const client = createRyotClient({
			query: () => Promise.reject(error),
			invokeOperation: () => Promise.reject(error),
		});
		const recipe: PreparedRecipe<string> = { document, decode: () => Result.succeed("unused") };

		await expect(client.data.query(recipe)).rejects.toBe(error);
		await expect(
			client.operations.invoke({ slug: "greet", input: {}, output: Greeting }),
		).rejects.toBe(error);
	});

	it("rejects invalid JSON input before consulting the adapter", async () => {
		let calls = 0;
		const client = createRyotClient({
			query: () => Promise.resolve({}),
			invokeOperation: () => {
				calls += 1;
				return Promise.resolve({ greeting: "unused" });
			},
		});

		await expect(
			Reflect.apply(client.operations.invoke, client.operations, [
				{ slug: "greet", output: Greeting, input: { invalid: undefined } },
			]),
		).rejects.toMatchObject({ reason: "invalid-input" });
		expect(calls).toBe(0);
	});

	it("rejects operations when the environment does not provide that capability", async () => {
		const client = createRyotClient({ query: () => Promise.resolve({}) });

		expect(client.data).not.toHaveProperty("invokeOperation");
		await expect(
			client.operations.invoke({ slug: "greet", input: {}, output: Greeting }),
		).rejects.toMatchObject({ reason: "unsupported-capability" });
	});

	it("hides the upload transfer behind a single call and decodes the token", async () => {
		const requests: TemporaryUploadRequest[] = [];
		const source = new Blob(["id,title"], { type: "text/csv" });
		const client = createRyotClient({
			query: () => Promise.resolve({}),
			uploadTemporary: (request) => {
				requests.push(request);
				return Promise.resolve(uploadToken);
			},
		});

		const request = { source, fileName: "items.csv", contentType: "text/csv" };
		await expect(client.uploads.uploadTemporary(request)).resolves.toEqual(uploadToken);
		expect(requests).toEqual([request]);
	});

	it("rejects uploads when the environment does not provide that capability", async () => {
		const client = createRyotClient({ query: () => Promise.resolve({}) });

		await expect(
			client.uploads.uploadTemporary({
				fileName: "items.csv",
				contentType: "text/csv",
				source: new Blob(["id,title"]),
			}),
		).rejects.toMatchObject({ reason: "unsupported-capability" });
	});

	it("rejects an upload result that is not a temporary upload token", async () => {
		const client = createRyotClient({
			query: () => Promise.resolve({}),
			uploadTemporary: () => Promise.resolve({ key: "assets/items.csv", type: "local" }),
		});

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
		const client = createRyotClient({
			query: () => Promise.resolve({}),
			resolveAssets: (request) => {
				requests.push(request);
				return Promise.resolve(resolutions);
			},
		});

		await expect(client.assets.resolve(assets)).resolves.toEqual(resolutions);
		expect(requests).toEqual([assets]);
	});

	it("rejects empty and non-managed asset input before consulting the adapter", async () => {
		let calls = 0;
		const client = createRyotClient({
			query: () => Promise.resolve({}),
			resolveAssets: () => {
				calls += 1;
				return Promise.resolve([]);
			},
		});

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
		const client = createRyotClient({
			query: () => Promise.resolve({}),
			resolveAssets: (_assets, signal) => {
				receivedSignal = signal;
				return new Promise((_resolve, reject) =>
					signal?.addEventListener("abort", () => reject(signal.reason), { once: true }),
				);
			},
		});
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
		const client = createRyotClient({
			query: () => Promise.resolve({}),
			resolveAssets: () => {
				calls += 1;
				return Promise.resolve(resolutions);
			},
		});

		await expect(client.assets.resolve(assets, { signal: controller.signal })).rejects.toBe(reason);
		expect(calls).toBe(0);
	});

	it("rejects asset resolution when the environment does not provide that capability", async () => {
		const client = createRyotClient({ query: () => Promise.resolve({}) });

		await expect(client.assets.resolve(assets)).rejects.toMatchObject({
			reason: "unsupported-capability",
		});
	});

	it("rejects malformed asset expiry, locators, and result batches", async () => {
		let response: unknown = [{ ...resolutions[0], expiresAt: "not-a-date" }];
		const client = createRyotClient({
			query: () => Promise.resolve({}),
			resolveAssets: () => Promise.resolve(response),
		});

		await expect(client.assets.resolve([localAsset])).rejects.toEqual(
			new RyotClientError("malformed-result"),
		);
		response = [{ ...resolutions[0], asset: { key: "other.png", type: "local" } }];
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
		const client = createRyotClient({
			query: () => Promise.resolve({}),
			resolveAssets: () => Promise.reject(error),
		});

		await expect(client.assets.resolve(assets)).rejects.toBe(error);
	});

	it("delegates navigation through the adapter", () => {
		const navigations: Array<{
			readonly mode: "push" | "replace";
			readonly target: RyotNavigationTarget;
		}> = [];
		const client = createRyotClient({
			query: () => Promise.resolve({}),
			navigate: (mode, target) => navigations.push({ mode, target }),
		});

		client.navigation.push({ kind: "route", path: "/items", search: { tab: "stats" } });
		client.navigation.replace({ kind: "entity", entityId: "entity-1" });

		expect(navigations).toEqual([
			{
				mode: "push",
				target: { kind: "route", path: "/items", search: { tab: "stats" } },
			},
			{ mode: "replace", target: { kind: "entity", entityId: "entity-1" } },
		]);
	});

	it("rejects navigation when the environment does not provide that capability", () => {
		const client = createRyotClient({ query: () => Promise.resolve({}) });

		expect(() => client.navigation.push({ kind: "route", path: "/items" })).toThrow(
			new RyotClientError("unsupported-capability"),
		);
	});

	it("normalizes unexpected navigation failures as transport errors", () => {
		const client = createRyotClient({
			query: () => Promise.resolve({}),
			navigate: () => {
				throw new Error("transport detail");
			},
		});

		expect(() => client.navigation.push({ kind: "route", path: "/items" })).toThrow(
			new RyotClientError("transport"),
		);
	});

	it("decodes theme snapshots and delegates reactive subscriptions", () => {
		let notifications = 0;
		let current: unknown = theme;
		const client = createRyotClient({
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
		});

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
		const unsupported = createRyotClient({ query: () => Promise.resolve({}) });
		const malformed = createRyotClient({
			query: () => Promise.resolve({}),
			theme: {
				subscribe: () => () => {},
				getSnapshot: () => ({ resolvedMode: "system" }),
			},
		});

		expect(() => unsupported.theme.getSnapshot()).toThrow(
			new RyotClientError("unsupported-capability"),
		);
		expect(() => unsupported.theme.subscribe(() => undefined)).toThrow(
			new RyotClientError("unsupported-capability"),
		);
		expect(() => malformed.theme.getSnapshot()).toThrow(new RyotClientError("malformed-result"));
	});
});
