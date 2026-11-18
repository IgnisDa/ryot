import { describe, expect } from "bun:test";

import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { bindTestRequest } from "@ryot-app/ryotql-recipes/test-utils";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import type { MediaPosition } from "../../shared/consumption";
import { catalogMessage } from "../../shared/messages.generated";
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

const reviewHost = (
	items: readonly { readonly id: string; readonly entitySchemaSlug: string }[],
	consumption: readonly { readonly entityId: string; readonly eventSchemaSlug: string }[] = [],
) =>
	defineSandboxTestHost(manifest, {
		executeRyotql: () => Effect.succeed(targetRows(items, consumption)),
	});

const reviewChange = (entityId: string, properties: Record<string, unknown>) => ({
	output: { count: 1 },
	changes: {
		events: {
			changes: [],
			creates: [
				{
					properties,
					eventSchemaSlug: "review",
					itemIdentity: `review:${entityId}`,
					entity: { entityId, kind: "existing" },
				},
			],
		},
	},
});

const createPositioned = (entitySchemaSlug: string, position: MediaPosition) =>
	runSandboxTestScript(
		definition,
		{ position, rating: 70, text: null, isSpoiler: false, entityId: "media-1" },
		reviewHost([{ id: "media-1", entitySchemaSlug }]),
		execution,
	);
const createLinked = (consumption: undefined | { entityId: string; eventSchemaSlug: string }) =>
	runSandboxTestScript(
		definition,
		{
			rating: 70,
			text: null,
			isSpoiler: false,
			entityId: "episode-1",
			consumptionEventId: "watch-1",
		},
		reviewHost(
			[{ id: "episode-1", entitySchemaSlug: "show-episode" }],
			consumption === undefined ? [] : [consumption],
		),
		execution,
	);
describe("create media review", () => {
	it.live(
		"returns trimmed text, rating and spoiler state as one review event",
		() =>
			Effect.gen(function* () {
				const documents: unknown[] = [];
				const host = defineSandboxTestHost(manifest, {
					executeRyotql: (document) =>
						Effect.sync(() => {
							documents.push(bindTestRequest(document));
							return targetRows([{ id: "media-1", entitySchemaSlug: "movie" }]);
						}),
				});
				expect(
					yield* runSandboxTestScript(
						definition,
						{ rating: 82.5, isSpoiler: true, entityId: "media-1", text: "  Great ending  " },
						host,
						execution,
					),
				).toEqual<unknown>(
					reviewChange("media-1", { rating: 82.5, isSpoiler: true, text: "Great ending" }),
				);
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
				expect(
					yield* runSandboxTestScript(
						definition,
						{ rating: null, isSpoiler: false, text: "Good work", entityId: "creator-1" },
						reviewHost([{ id: "creator-1", entitySchemaSlug: "movie" }]),
						execution,
					),
				).toEqual<unknown>(reviewChange("creator-1", { isSpoiler: false, text: "Good work" }));
			}),
		testTimeout,
	);

	it.live(
		"stores the position of a positional review and rejects it for other targets",
		() =>
			Effect.gen(function* () {
				expect(
					yield* createPositioned("manga", { volume: 2, position: 12, unit: "chapters" }),
				).toEqual<unknown>(
					reviewChange("media-1", {
						rating: 70,
						position: { volume: 2, position: 12, unit: "chapters" },
					}),
				);
				for (const [slug, position, reason] of [
					[
						"movie",
						{ position: 1, unit: "episodes" },
						catalogMessage("rejection.position.unsupported"),
					],
					[
						"anime",
						{ position: 1, unit: "chapters" },
						catalogMessage("rejection.position.unsupported"),
					],
					[
						"anime",
						{ position: 1.5, unit: "episodes" },
						catalogMessage("rejection.position.episode-not-whole"),
					],
				] as const) {
					expect(yield* Effect.flip(createPositioned(slug, position))).toMatchObject({ reason });
				}
			}),
		testTimeout,
	);

	it.live(
		"treats a null position as no position on any media type",
		() =>
			Effect.gen(function* () {
				expect(
					yield* runSandboxTestScript(
						definition,
						{ rating: 70, text: null, position: null, isSpoiler: false, entityId: "media-1" },
						reviewHost([{ id: "media-1", entitySchemaSlug: "movie" }]),
						execution,
					),
				).toEqual<unknown>(reviewChange("media-1", { rating: 70 }));
			}),
		testTimeout,
	);

	it.live(
		"links the review to an occurrence of its subject and refuses any other record",
		() =>
			Effect.gen(function* () {
				expect(
					yield* createLinked({ entityId: "episode-1", eventSchemaSlug: "progress" }),
				).toEqual<unknown>(
					reviewChange("episode-1", { rating: 70, consumptionEventId: "watch-1" }),
				);
				for (const [consumption, reason] of [
					[undefined, catalogMessage("rejection.review.consumption-not-found")],
					[
						{ entityId: "episode-1", eventSchemaSlug: "review" },
						catalogMessage("rejection.review.consumption-not-reviewable"),
					],
					[
						{ entityId: "show-1", eventSchemaSlug: "complete" },
						catalogMessage("rejection.review.consumption-other-entity"),
					],
				] as const) {
					expect(yield* Effect.flip(createLinked(consumption))).toMatchObject({ reason });
				}
			}),
		testTimeout,
	);

	it.live(
		"rejects a review when no visible plugin-owned target exists",
		() =>
			Effect.gen(function* () {
				const result = yield* Effect.result(
					runSandboxTestScript(
						definition,
						{ rating: null, text: "Review", isSpoiler: false, entityId: "missing" },
						reviewHost([]),
						execution,
					),
				);
				expect(result).toMatchObject({
					_tag: "Failure",
					failure: { reason: catalogMessage("rejection.review.target-not-found") },
				});
			}),
		testTimeout,
	);

	for (const rating of [0, 82.5, 100]) {
		it.live(
			`saves a rating-only review of ${rating} without text or a spoiler flag`,
			() =>
				Effect.gen(function* () {
					expect(
						yield* runSandboxTestScript(
							definition,
							{ rating, text: "   ", isSpoiler: true, entityId: "media-1" },
							reviewHost([{ id: "media-1", entitySchemaSlug: "movie" }]),
							execution,
						),
					).toEqual<unknown>(reviewChange("media-1", { rating }));
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
