import { describe, expect, it } from "@effect/vitest";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Effect, Fiber, Result, Schema } from "effect";

import { createTestRyotAdapter } from "../testing";
import { createRyotClient } from "./client";
import { RyotClientError } from "./errors";

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
	it.effect("refreshes collection screens only after saved changes", () =>
		Effect.gen(function* () {
			let refreshes = 0;
			for (const outcome of [
				{ kind: "saved" },
				{ kind: "removed" },
				{ kind: "cancelled" },
			] as const) {
				const client = createRyotClient(
					createTestRyotAdapter({ addToCollection: () => Effect.succeed(outcome) }),
				);
				const unsubscribe = client.mutationCompleted.subscribe(() => {
					refreshes++;
				});
				yield* client.screens.addToCollection({ entityId: "entity-1" });
				unsubscribe();
			}
			expect(refreshes).toBe(2);
			for (const outcome of [
				{ kind: "saved", collectionId: "collection-1" },
				{ kind: "deleted" },
				{ kind: "cancelled" },
			] as const) {
				const client = createRyotClient(
					createTestRyotAdapter({ editCollection: () => Effect.succeed(outcome) }),
				);
				const unsubscribe = client.mutationCompleted.subscribe(() => {
					refreshes++;
				});
				yield* client.screens.editCollection({});
				unsubscribe();
			}
			expect(refreshes).toBe(4);
		}),
	);
	it.effect("does not publish mutation refresh for read-only context operations", () =>
		Effect.gen(function* () {
			let refreshes = 0;
			const client = createRyotClient(
				createTestRyotAdapter({ invokeOperation: () => Effect.succeed("result") }),
			);
			const unsubscribe = client.mutationCompleted.subscribe(() => {
				refreshes++;
			});
			const request = {
				input: null,
				slug: "context",
				output: Schema.String,
				inputSchema: Schema.Null,
				packageId: PluginPackageId.make("ryot/fitness"),
			};
			yield* client.operations.invoke({ ...request, refreshOnSuccess: false });
			expect(refreshes).toBe(0);
			yield* client.operations.invoke(request);
			expect(refreshes).toBe(1);
			unsubscribe();
		}),
	);
	it.live("validates collection screen requests before the adapter and decodes outcomes", () =>
		Effect.gen(function* () {
			const calls: unknown[] = [];
			const client = createRyotClient(
				createTestRyotAdapter({
					addToCollection: (request) =>
						Effect.sync(() => {
							calls.push(request);
							return { kind: "removed" };
						}),
					editCollection: (request) =>
						Effect.sync(() => {
							calls.push(request);
							return { kind: "saved", collectionId: "collection-1" };
						}),
				}),
			);

			expect(yield* client.screens.editCollection({})).toEqual({
				kind: "saved",
				collectionId: "collection-1",
			});
			expect(
				yield* client.screens.addToCollection({ collectionId: "c-1", entityId: "entity-1" }),
			).toEqual({ kind: "removed" });
			expect(calls).toEqual([{}, { collectionId: "c-1", entityId: "entity-1" }]);
			const renamed = { name: "Renamed", collectionId: "c-1" };
			const withProperties = { properties: {}, entityId: "entity-1" };
			expect(yield* Effect.flip(client.screens.editCollection(renamed))).toMatchObject({
				reason: "invalid-input",
			});
			expect(yield* Effect.flip(client.screens.addToCollection(withProperties))).toMatchObject({
				reason: "invalid-input",
			});
			expect(calls).toHaveLength(2);

			const missing = createRyotClient(createTestRyotAdapter());
			expect(yield* Effect.flip(missing.screens.editCollection({}))).toMatchObject({
				reason: "unsupported-capability",
			});
			expect(
				yield* Effect.flip(missing.screens.addToCollection({ entityId: "entity-1" })),
			).toMatchObject({ reason: "unsupported-capability" });
			const malformed = createRyotClient(
				createTestRyotAdapter({
					addToCollection: () => Effect.succeed({ kind: "deleted" }),
					editCollection: () => Effect.succeed({ kind: "saved", name: "Renamed" }),
				}),
			);
			expect(yield* Effect.flip(malformed.screens.editCollection({}))).toMatchObject({
				reason: "malformed-result",
			});
			expect(
				yield* Effect.flip(malformed.screens.addToCollection({ entityId: "entity-1" })),
			).toMatchObject({ reason: "malformed-result" });
		}),
	);
	it.live("validates external links before adapter access and decodes launch results", () =>
		Effect.gen(function* () {
			const calls: unknown[] = [];
			const client = createRyotClient(
				createTestRyotAdapter({
					openExternalLink: (request) =>
						Effect.sync(() => {
							calls.push(request);
							return { outcome: "success" };
						}),
				}),
			);
			for (const url of [
				"/relative",
				"javascript:alert(1)",
				"data:text/html,hello",
				"file:///tmp/file",
				"https://",
				"",
			]) {
				expect(yield* Effect.flip(client.links.open({ url }))).toMatchObject({
					reason: "invalid-request",
				});
			}
			expect(calls).toEqual([]);
			for (const url of ["http://example.test/path", "https://example.test/path?q=a#b"]) {
				expect(yield* client.links.open({ url })).toEqual({ outcome: "success" });
			}
			expect(calls).toEqual([
				{ url: "http://example.test/path" },
				{ url: "https://example.test/path?q=a#b" },
			]);
			const missing = createRyotClient(createTestRyotAdapter());
			expect(yield* Effect.flip(missing.links.open({ url: "https://example.test" }))).toMatchObject(
				{ reason: "unsupported-capability" },
			);
			const malformed = createRyotClient(
				createTestRyotAdapter({ openExternalLink: () => Effect.void }),
			);
			expect(
				yield* Effect.flip(malformed.links.open({ url: "https://example.test" })),
			).toMatchObject({ reason: "malformed-result" });
			for (const reason of ["activation-required", "link-open-failed"] as const) {
				const failing = createRyotClient(
					createTestRyotAdapter({
						openExternalLink: () => Effect.fail(new RyotClientError(reason)),
					}),
				);
				expect(
					yield* Effect.flip(failing.links.open({ url: "https://example.test" })),
				).toMatchObject({ reason });
			}
		}),
	);
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
			const invalidUpload = {
				fileName: "x",
				contentType: "text/plain",
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The test feeds a non-Blob to exercise runtime input validation
				source: "not a Blob" as unknown as Blob,
			};
			expect(
				yield* Effect.flip(
					client.operations.invoke({
						output,
						slug: "greet",
						input: Number.NaN,
						packageId: "test/fixture",
						inputSchema: Schema.Finite,
					}),
				),
			).toMatchObject({ reason: "invalid-input" });
			expect(calls).toBe(0);
			expect(
				yield* Effect.flip(
					client.operations.invoke({
						output,
						input: {},
						slug: "greet",
						packageId: "test/fixture",
						inputSchema: Schema.Struct({}),
					}),
				),
			).toMatchObject({ reason: "malformed-result" });
			expect(calls).toBe(1);
			expect(yield* Effect.flip(client.collections.create({ name: "Favorites" }))).toMatchObject({
				reason: "unsupported-capability",
			});
			expect(yield* Effect.flip(client.uploads.uploadTemporary(invalidUpload))).toMatchObject({
				reason: "invalid-input",
			});
			expect(yield* Effect.flip(client.uploads.uploadPermanent(invalidUpload))).toMatchObject({
				reason: "invalid-input",
			});
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
					output: Schema.String,
					packageId: "test/fixture",
					inputSchema: Schema.Struct({}),
				}),
			).toBe("saved");
			expect(
				yield* Effect.flip(
					client.operations.invoke({
						input: {},
						slug: "save",
						output: Schema.Finite,
						packageId: "test/fixture",
						inputSchema: Schema.Struct({}),
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

	it.live("validates iOS live activity results and preserves adapter failures", () =>
		Effect.gen(function* () {
			const request = { pluginId: PluginId.make("fixture") };
			const received: unknown[] = [];
			const client = createRyotClient(
				createTestRyotAdapter({
					iosLiveActivity: (value) =>
						Effect.sync(() => {
							received.push(value);
							return { status: "unsupported" };
						}),
				}),
			);
			expect(yield* client.iosLiveActivities.availability(request)).toEqual({
				status: "unsupported",
			});
			expect(received).toEqual([{ ...request, action: "availability" }]);

			const malformed = createRyotClient(
				createTestRyotAdapter({ iosLiveActivity: () => Effect.succeed({ status: "invalid" }) }),
			);
			expect(yield* Effect.flip(malformed.iosLiveActivities.list(request))).toMatchObject({
				reason: "malformed-result",
			});

			const failed = createRyotClient(
				createTestRyotAdapter({
					iosLiveActivity: () => Effect.fail(new RyotClientError("transport")),
				}),
			);
			expect(yield* Effect.flip(failed.iosLiveActivities.availability(request))).toMatchObject({
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
			const fiber = yield* Effect.forkChild(client.assets.resolve([asset]), {
				startImmediately: true,
			});
			yield* Fiber.interrupt(fiber);
			expect(interrupted).toBe(1);
		}),
	);

	it.live("keeps upload bytes and validates upload results", () =>
		Effect.gen(function* () {
			const source = new Blob(["id,title"], { type: "text/csv" });
			const uploads: Array<{ readonly action: string }> = [];
			const client = createRyotClient(
				createTestRyotAdapter({
					resolveAssets: () =>
						Effect.succeed([{ ...resolution, asset: { type: "local", key: "other.png" } }]),
					upload: (request) =>
						Effect.sync(() => {
							uploads.push(request);
							if (request.action === "temporary") {
								expect(request.source).toBe(source);
								return {
									action: "temporary",
									token: { token: "temporary-1", expiresAt: "2026-01-01T00:00:00.000Z" },
								};
							}
							if (request.action === "permanent") {
								expect(request.source).toBe(source);
								return { asset, action: "permanent" };
							}
							return { action: "cleanup", status: "deleted" };
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
			expect(
				yield* client.uploads.uploadPermanent({
					source,
					fileName: "items.csv",
					contentType: "text/csv",
				}),
			).toEqual(asset);
			expect(yield* client.uploads.cleanup(asset)).toEqual({ status: "deleted" });
			expect(uploads.map(({ action }) => action)).toEqual(["temporary", "permanent", "cleanup"]);
			expect(
				yield* Effect.flip(
					createRyotClient(
						createTestRyotAdapter({
							upload: () => Effect.succeed({ action: "cleanup", status: "unknown" }),
						}),
					).uploads.cleanup(asset),
				),
			).toMatchObject({ reason: "malformed-result" });
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
