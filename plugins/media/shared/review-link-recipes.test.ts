import { describe, expect, it } from "bun:test";

import { Result } from "@ryot-app/plugin-kit/effect";
import { bindRecipe, rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { validateRyotQLDocument } from "@ryot-app/ryotql/validator";

import { ryotqlDocumentNodes } from "../tests/ryotql-test-utils";
import { mediaReviewableOccurrencesRecipe, mediaReviewLinksRecipe } from "./review-link-recipes";

const reference = { kind: "self" } as const;

const rows = (items: readonly unknown[]) =>
	rowsResult(items, { limit: 100, hasMore: false, nextCursor: null });

const occurrence = {
	position: null,
	dateUnknown: null,
	id: "event_0000_complete",
	calendarDate: "2026-11-03",
	eventSchemaSlug: "complete",
	createdAt: "2026-11-03T20:00:00.000Z",
	occurredAt: "2026-11-03T20:00:00.000Z",
};

const review = {
	text: null,
	rating: 80,
	isSpoiler: null,
	entityId: "media-1",
	sessionEntityId: null,
	id: "event_0000_review",
	consumptionEventId: occurrence.id,
	createdAt: "2026-11-04T09:00:00.000Z",
	occurredAt: "2026-11-04T09:00:00.000Z",
	position: { position: 4, unit: "episodes" },
	properties: { rating: 80, consumptionEventId: occurrence.id },
};

describe("review link recipes", () => {
	it("resolves named occurrences and the reviews that name them in one plugin-owned document", () => {
		const recipe = bindRecipe(mediaReviewLinksRecipe({ reference: reference }), {
			eventIds: [occurrence.id, review.id],
		});
		expect(validateRyotQLDocument(recipe.document, { type: "plugin" }).error).toBeNull();
		const nodes = ryotqlDocumentNodes(recipe.document.queries["reviews"]);
		expect(nodes).toContainEqual({ type: "literal", value: "review" });
		expect(nodes).toContainEqual({ type: "literal", value: occurrence.id });
		expect(nodes).toContainEqual({ reference, type: "pluginId" });
		for (const slug of ["complete", "item-complete", "progress", "dropped", "on_hold"]) {
			expect(ryotqlDocumentNodes(recipe.document.queries["occurrences"])).toContainEqual({
				value: slug,
				type: "literal",
			});
		}
		expect(
			Result.getOrThrow(
				recipe.decode({ data: { reviews: rows([review]), occurrences: rows([occurrence]) } }),
			),
		).toEqual<unknown>({ reviews: [review], occurrences: [occurrence] });
	});

	it("lists an entity's recent occurrences newest first", () => {
		const recipe = bindRecipe(mediaReviewableOccurrencesRecipe({ reference: reference }), {
			limit: 20,
			entityId: "media-1",
		});
		expect(validateRyotQLDocument(recipe.document, { type: "plugin" }).error).toBeNull();
		const query = recipe.document.queries["events"];
		expect(query?.output).toMatchObject({ pagination: { limit: 20 } });
		expect(ryotqlDocumentNodes(query)).toContainEqual({ type: "literal", value: "media-1" });
		expect(
			Result.getOrThrow(recipe.decode({ data: { events: rows([occurrence]) } })),
		).toEqual<unknown>([occurrence]);
		expect(() =>
			Result.getOrThrow(
				recipe.decode({ data: { events: rows([{ ...occurrence, eventSchemaSlug: "review" }]) } }),
			),
		).toThrow();
	});
});
