import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Effect, Fiber, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { createRyotClient, RyotClientError } from "./index";
import { createTestRyotAdapter } from "./testing";

const document = { output: {}, queries: {} } as PreparedRecipe<string>["document"];
const recipe: PreparedRecipe<string> = {
	document,
	decode: (response) =>
		Result.map(
			Schema.decodeUnknownResult(Schema.Struct({ value: Schema.String }))(response),
			({ value }) => value,
		),
};
const asset = { type: "local", key: "permanent/image.png" } as const;
const resolution = {
	asset,
	expiresAt: "2026-01-01T00:15:00.000Z",
	url: "https://ryot.test/api/uploads/local/download?key=permanent%2Fimage.png",
};

describe("Effect-native client capabilities", () => {
	// oxlint-disable-next-line effecttsgo/async-function -- Vitest awaits the Effect runtime Promise boundary.
	it("sends only the query document and decodes the response", async () => {
		const received: unknown[] = [];
		const client = createRyotClient(
			createTestRyotAdapter({
				query: (request) =>
					Effect.sync(() => {
						received.push(request);
						return { value: "decoded" };
					}),
			}),
		);
		expect(await Effect.runPromise(client.data.query(recipe))).toBe("decoded");
		expect(received).toEqual([document]);
	});

	// oxlint-disable-next-line effecttsgo/async-function -- Vitest awaits the Effect runtime Promise boundary.
	it("validates before invoking adapters and retains the public failure reasons", async () => {
		let calls = 0;
		const client = createRyotClient(
			createTestRyotAdapter({
				invokeOperation: () =>
					Effect.sync(() => {
						calls++;
						return { greeting: 42 };
					}),
			}),
		);
		const output = Schema.Struct({ greeting: Schema.String });
		await expect(
			Effect.runPromise(
				Reflect.apply(client.operations.invoke, client.operations, [
					{ output, slug: "greet", pluginSlug: "fixture", input: { bad: undefined } },
				]),
			),
		).rejects.toMatchObject({ reason: "invalid-input" });
		expect(calls).toBe(0);
		await expect(
			Effect.runPromise(
				client.operations.invoke({ output, input: {}, slug: "greet", pluginSlug: "fixture" }),
			),
		).rejects.toMatchObject({ reason: "malformed-result" });
		expect(calls).toBe(1);
		await expect(
			Effect.runPromise(client.collections.create({ name: "Favorites" })),
		).rejects.toMatchObject({ reason: "unsupported-capability" });
		await expect(
			Effect.runPromise(
				client.uploads.uploadTemporary({
					fileName: "x",
					contentType: "text/plain",
					source: "not a Blob" as unknown as Blob,
				}),
			),
		).rejects.toMatchObject({ reason: "invalid-input" });
	});

	// oxlint-disable-next-line effecttsgo/async-function -- Vitest awaits the Effect runtime Promise boundary.
	it("signals completed mutations only after valid output", async () => {
		let hints = 0;
		const client = createRyotClient(
			createTestRyotAdapter({ invokeOperation: () => Effect.succeed("saved") }),
		);
		client.mutationCompleted.subscribe(() => hints++);
		expect(
			await Effect.runPromise(
				client.operations.invoke({
					input: {},
					slug: "save",
					pluginSlug: "fixture",
					output: Schema.String,
				}),
			),
		).toBe("saved");
		await expect(
			Effect.runPromise(
				client.operations.invoke({
					input: {},
					slug: "save",
					pluginSlug: "fixture",
					output: Schema.Number,
				}),
			),
		).rejects.toMatchObject({ reason: "malformed-result" });
		expect(hints).toBe(1);
	});

	// oxlint-disable-next-line effecttsgo/async-function -- Vitest awaits the Effect runtime Promise boundary.
	it("preserves tagged failures and normalizes unexpected adapter failures", async () => {
		const failure = new RyotClientError("asset-failed");
		const canonical = createRyotClient(
			createTestRyotAdapter({ resolveAssets: () => Effect.fail(failure) }),
		);
		const unexpected = createRyotClient(
			createTestRyotAdapter({
				query: () => {
					throw new Error("network details");
				},
			}),
		);
		await expect(Effect.runPromise(canonical.assets.resolve([asset]))).rejects.toBe(failure);
		await expect(Effect.runPromise(unexpected.data.query(recipe))).rejects.toMatchObject({
			reason: "transport",
		});
	});

	// oxlint-disable-next-line effecttsgo/async-function -- Vitest awaits the Effect runtime Promise boundary.
	it("interrupts a pending adapter Effect without an explicit AbortSignal argument", async () => {
		let interrupted = 0;
		const client = createRyotClient(
			createTestRyotAdapter({
				resolveAssets: () =>
					Effect.never.pipe(
						Effect.onInterrupt(() =>
							Effect.sync(() => {
								interrupted++;
							}),
						),
					),
			}),
		);
		const fiber = Effect.runFork(client.assets.resolve([asset]));
		await Effect.runPromise(Fiber.interrupt(fiber));
		expect(interrupted).toBe(1);
	});

	// oxlint-disable-next-line effecttsgo/async-function -- Vitest awaits the Effect runtime Promise boundary.
	it("keeps upload bytes and validates asset correlation", async () => {
		const source = new Blob(["id,title"], { type: "text/csv" });
		const client = createRyotClient(
			createTestRyotAdapter({
				resolveAssets: () =>
					Effect.succeed([{ ...resolution, asset: { type: "local", key: "other.png" } }]),
				uploadTemporary: (request) =>
					Effect.sync(() => {
						expect(request.source).toBe(source);
						return { token: "temporary-1", expiresAt: "2026-01-01T00:00:00.000Z" };
					}),
			}),
		);
		expect(
			await Effect.runPromise(
				client.uploads.uploadTemporary({ source, fileName: "items.csv", contentType: "text/csv" }),
			),
		).toMatchObject({ token: "temporary-1" });
		await expect(Effect.runPromise(client.assets.resolve([asset]))).rejects.toMatchObject({
			reason: "malformed-result",
		});
	});

	it("normalizes and disposes synchronous entity interest subscriptions", () => {
		let disposed = 0;
		const seen: unknown[] = [];
		const client = createRyotClient(
			createTestRyotAdapter({
				watchEntities: (interest) => {
					seen.push(interest);
					return {
						update: (next) => seen.push(next),
						dispose: () => {
							disposed++;
						},
					};
				},
			}),
		);
		const subscription = client.entities.watch(
			{ foreground: ["a", "b"], visible: ["c", "a", "c"] },
			() => {},
		);
		expect(seen).toEqual([{ visible: ["c"], foreground: ["a", "b"] }]);
		subscription.dispose();
		subscription.dispose();
		expect(disposed).toBe(1);
		expect(() => subscription.update({ visible: [], foreground: [] })).toThrow(
			new RyotClientError("disposed"),
		);
	});
});
