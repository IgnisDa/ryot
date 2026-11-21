import { describe, expect } from "bun:test";

import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { TestClock } from "effect/testing";

import { trendingChanges } from "./trending";

const upserted = (externalId: string) =>
	({ externalId, kind: "upserted", entitySchemaSlug: "movie" }) as const;

describe("trending changes", () => {
	it.effect(
		"upserts the batch, ranks it from 1 with the clock's fetchedAt, and replaces only its schema's rows",
		() =>
			Effect.gen(function* () {
				const fetchedAt = "2026-01-01T12:00:00.000Z";
				yield* TestClock.setTime(Date.parse(fetchedAt));
				expect(
					yield* trendingChanges("movie", [
						{ name: "First", externalId: "1" },
						{ name: "Second", externalId: "2" },
					]),
				).toEqual({
					globalEntities: [
						{
							name: "First",
							properties: {},
							externalId: "1",
							populatedAt: null,
							entitySchemaSlug: "movie",
						},
						{
							name: "Second",
							properties: {},
							externalId: "2",
							populatedAt: null,
							entitySchemaSlug: "movie",
						},
					],
					globalRelationships: [
						{
							relationshipSchemaSlug: "media-trending",
							selector: { type: "self", entitySchemaSlug: "movie" },
							relationships: [
								{
									source: upserted("1"),
									target: upserted("1"),
									properties: { rank: 1, fetchedAt },
								},
								{
									source: upserted("2"),
									target: upserted("2"),
									properties: { rank: 2, fetchedAt },
								},
							],
						},
					],
				});
			}),
		testTimeout,
	);
});
