import { describe, expect } from "bun:test";

import { EventId } from "@ryot-app/contract/schema/brands";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import type { MediaPosition } from "../../shared/consumption";
import { execution } from "../../tests/backend/automations/automation-test-utils";
import { ryotqlDocumentNodes } from "../../tests/ryotql-test-utils";
import definition, { manifest } from "./media-review-create.sandbox";

const rows = (items: readonly unknown[]) => ({
	items,
	type: "rows",
	pageInfo: { limit: 1, hasMore: false, nextCursor: null },
});

const targetRows = (
	items: readonly { readonly id: string; readonly entitySchemaSlug: string }[],
	consumption: readonly { readonly entityId: string; readonly eventSchemaSlug: string }[] = [],
) => ({ data: { target: rows(items), consumption: rows(consumption) } });

describe("create media review", () => {
	it.live(
		"writes trimmed text, rating and spoiler state to one review event",
		() =>
			Effect.gen(function* () {
				const creates: unknown[] = [];
				const documents: unknown[] = [];
				const host = defineSandboxTestHost(manifest, {
					executeRyotql: (document) =>
						Effect.sync(() => {
							documents.push(document);
							return targetRows([{ id: "media-1", entitySchemaSlug: "movie" }]);
						}),
					createEvents: (items) =>
						Effect.sync(() => {
							creates.push(items);
							return {
								count: 1,
								outcomes: [
									{ index: 0, status: "written" as const, eventId: EventId.make("review-1") },
								],
							};
						}),
				});
				expect(
					yield* runSandboxTestScript(
						definition,
						{ rating: 82.5, isSpoiler: true, entityId: "media-1", text: "  Great ending  " },
						host,
						execution,
					),
				).toEqual({ count: 1 });
				expect(creates).toEqual([
					[
						{
							entityId: "media-1",
							eventSchemaSlug: "review",
							properties: { rating: 82.5, isSpoiler: true, text: "Great ending" },
						},
					],
				]);
				const nodes = ryotqlDocumentNodes(documents);
				expect(nodes).toContainEqual({ type: "pluginId", reference: { kind: "self" } });
				expect(nodes).toContainEqual({ type: "literal", value: "media-1" });
				expect(nodes).toContainEqual({ type: "literal", value: "person" });
				expect(nodes).toContainEqual({ type: "literal", value: "movie-group" });
				expect(nodes).not.toContainEqual({ value: "genre", type: "literal" });
				expect(nodes).not.toContainEqual({ type: "literal", value: "media-library" });
			}),
		testTimeout,
	);

	it.live(
		"omits the rating when none was supplied",
		() =>
			Effect.gen(function* () {
				const creates: unknown[] = [];
				const host = defineSandboxTestHost(manifest, {
					executeRyotql: () =>
						Effect.succeed(targetRows([{ id: "creator-1", entitySchemaSlug: "movie" }])),
					createEvents: (items) =>
						Effect.sync(() => {
							creates.push(items);
							return {
								count: 1,
								outcomes: [
									{ index: 0, status: "written" as const, eventId: EventId.make("review-1") },
								],
							};
						}),
				});
				yield* runSandboxTestScript(
					definition,
					{ rating: null, isSpoiler: false, text: "Good work", entityId: "creator-1" },
					host,
					execution,
				);
				expect(creates).toEqual([
					[
						{
							entityId: "creator-1",
							eventSchemaSlug: "review",
							properties: { isSpoiler: false, text: "Good work" },
						},
					],
				]);
			}),
		testTimeout,
	);

	it.live(
		"stores the position of a positional review and rejects it for other targets",
		() =>
			Effect.gen(function* () {
				const creates: unknown[] = [];
				const create = (entitySchemaSlug: string, position: MediaPosition) =>
					runSandboxTestScript(
						definition,
						{ position, rating: 70, text: null, isSpoiler: false, entityId: "media-1" },
						defineSandboxTestHost(manifest, {
							executeRyotql: () =>
								Effect.succeed(targetRows([{ id: "media-1", entitySchemaSlug }])),
							createEvents: (items) =>
								Effect.sync(() => {
									creates.push(items);
									return {
										count: 1,
										outcomes: [
											{ index: 0, status: "written" as const, eventId: EventId.make("review-1") },
										],
									};
								}),
						}),
						execution,
					);
				yield* create("manga", { volume: 2, position: 12, unit: "chapters" });
				expect(creates).toEqual([
					[
						{
							entityId: "media-1",
							eventSchemaSlug: "review",
							properties: { rating: 70, position: { volume: 2, position: 12, unit: "chapters" } },
						},
					],
				]);
				for (const [slug, position, message] of [
					[
						"movie",
						{ position: 1, unit: "episodes" },
						"This media type does not track this position",
					],
					[
						"anime",
						{ position: 1, unit: "chapters" },
						"This media type does not track this position",
					],
					["anime", { position: 1.5, unit: "episodes" }, "Episode numbers are whole numbers"],
				] as const) {
					expect(yield* Effect.flip(create(slug, position))).toMatchObject({ message });
				}
				expect(creates).toHaveLength(1);
			}),
		testTimeout,
	);

	it.live(
		"links the review to an occurrence of its subject and refuses any other record",
		() =>
			Effect.gen(function* () {
				const creates: unknown[] = [];
				const create = (consumption: undefined | { entityId: string; eventSchemaSlug: string }) =>
					runSandboxTestScript(
						definition,
						{
							rating: 70,
							text: null,
							isSpoiler: false,
							entityId: "episode-1",
							consumptionEventId: "watch-1",
						},
						defineSandboxTestHost(manifest, {
							createEvents: (items) =>
								Effect.sync(() => {
									creates.push(items);
									return { count: 1, outcomes: [] };
								}),
							executeRyotql: () =>
								Effect.succeed(
									targetRows(
										[{ id: "episode-1", entitySchemaSlug: "show-episode" }],
										consumption === undefined ? [] : [consumption],
									),
								),
						}),
						execution,
					);
				yield* create({ entityId: "episode-1", eventSchemaSlug: "progress" });
				expect(creates).toEqual([
					[
						{
							entityId: "episode-1",
							eventSchemaSlug: "review",
							properties: { rating: 70, consumptionEventId: "watch-1" },
						},
					],
				]);
				for (const [consumption, message] of [
					[undefined, "The record this review is about no longer exists."],
					[
						{ entityId: "episode-1", eventSchemaSlug: "review" },
						"A review can only be about a completion, progress or status record.",
					],
					[
						{ entityId: "show-1", eventSchemaSlug: "complete" },
						"A review can only be about a record of what it reviews.",
					],
				] as const) {
					expect(yield* Effect.flip(create(consumption))).toMatchObject({ message });
				}
				expect(creates).toHaveLength(1);
			}),
		testTimeout,
	);

	it.live(
		"does not write when no visible plugin-owned review target exists",
		() =>
			Effect.gen(function* () {
				const writes: unknown[] = [];
				const host = defineSandboxTestHost(manifest, {
					executeRyotql: () => Effect.succeed(targetRows([])),
					createEvents: (items) =>
						Effect.sync(() => {
							writes.push(items);
							return { count: 0, outcomes: [] };
						}),
				});
				const result = yield* Effect.result(
					runSandboxTestScript(
						definition,
						{ rating: null, text: "Review", isSpoiler: false, entityId: "missing" },
						host,
						execution,
					),
				);
				expect(result._tag).toBe("Failure");
				expect(writes).toEqual([]);
			}),
		testTimeout,
	);

	for (const rating of [0, 82.5, 100]) {
		it.live(
			`saves a rating-only review of ${rating} without text or a spoiler flag`,
			() =>
				Effect.gen(function* () {
					const creates: unknown[] = [];
					const host = defineSandboxTestHost(manifest, {
						executeRyotql: () =>
							Effect.succeed(targetRows([{ id: "media-1", entitySchemaSlug: "movie" }])),
						createEvents: (items) =>
							Effect.sync(() => {
								creates.push(items);
								return { count: 1, outcomes: [] };
							}),
					});
					expect(
						yield* runSandboxTestScript(
							definition,
							{ rating, text: "   ", isSpoiler: true, entityId: "media-1" },
							host,
							execution,
						),
					).toEqual({ count: 1 });
					expect(creates).toEqual([
						[{ entityId: "media-1", properties: { rating }, eventSchemaSlug: "review" }],
					]);
				}),
			testTimeout,
		);
	}

	it.live(
		"rejects an empty review before reading or writing",
		() =>
			Effect.gen(function* () {
				const host = defineSandboxTestHost(manifest, {});
				const result = yield* Effect.result(
					runSandboxTestScript(
						definition,
						{ text: "   ", rating: null, isSpoiler: false, entityId: "media-1" },
						host,
						execution,
					),
				);
				expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "SchemaError" } });
			}),
		testTimeout,
	);
});
