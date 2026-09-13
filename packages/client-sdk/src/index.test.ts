import { describe, expect, it } from "@effect/vitest";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Effect, Fiber, Result, Schema } from "effect";

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
	it.live("sends only the query document and decodes the response", () =>
		Effect.gen(function* () {
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
			expect(yield* client.data.query(recipe)).toBe("decoded");
			expect(received).toEqual([document]);
		}),
	);

	it.live("validates before invoking adapters and retains the public failure reasons", () =>
		Effect.gen(function* () {
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
			expect(
				yield* Effect.flip(
					Reflect.apply(client.operations.invoke, client.operations, [
						{ output, slug: "greet", pluginSlug: "fixture", input: { bad: undefined } },
					]),
				),
			).toMatchObject({ reason: "invalid-input" });
			expect(calls).toBe(0);
			expect(
				yield* Effect.flip(
					client.operations.invoke({ output, input: {}, slug: "greet", pluginSlug: "fixture" }),
				),
			).toMatchObject({ reason: "malformed-result" });
			expect(calls).toBe(1);
			expect(yield* Effect.flip(client.collections.create({ name: "Favorites" }))).toMatchObject({
				reason: "unsupported-capability",
			});
			expect(
				yield* Effect.flip(
					client.uploads.uploadTemporary({
						fileName: "x",
						contentType: "text/plain",
						// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The test feeds a non-Blob to exercise runtime input validation
						source: "not a Blob" as unknown as Blob,
					}),
				),
			).toMatchObject({ reason: "invalid-input" });
		}),
	);

	it.live("signals completed mutations only after valid output", () =>
		Effect.gen(function* () {
			let hints = 0;
			const client = createRyotClient(
				createTestRyotAdapter({ invokeOperation: () => Effect.succeed("saved") }),
			);
			client.mutationCompleted.subscribe(() => hints++);
			expect(
				yield* client.operations.invoke({
					input: {},
					slug: "save",
					pluginSlug: "fixture",
					output: Schema.String,
				}),
			).toBe("saved");
			expect(
				yield* Effect.flip(
					client.operations.invoke({
						input: {},
						slug: "save",
						pluginSlug: "fixture",
						output: Schema.Finite,
					}),
				),
			).toMatchObject({ reason: "malformed-result" });
			expect(hints).toBe(1);
		}),
	);

	it.live("preserves tagged failures and normalizes unexpected adapter failures", () =>
		Effect.gen(function* () {
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
			expect(yield* Effect.flip(canonical.assets.resolve([asset]))).toBe(failure);
			expect(yield* Effect.flip(unexpected.data.query(recipe))).toMatchObject({
				reason: "transport",
			});
		}),
	);

	it.live("interrupts a pending adapter Effect without an explicit AbortSignal argument", () =>
		Effect.gen(function* () {
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
			yield* Fiber.interrupt(fiber);
			expect(interrupted).toBe(1);
		}),
	);

	it.live("keeps upload bytes and validates asset correlation", () =>
		Effect.gen(function* () {
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
				yield* client.uploads.uploadTemporary({
					source,
					fileName: "items.csv",
					contentType: "text/csv",
				}),
			).toMatchObject({ token: "temporary-1" });
			expect(yield* Effect.flip(client.assets.resolve([asset]))).toMatchObject({
				reason: "malformed-result",
			});
		}),
	);

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
