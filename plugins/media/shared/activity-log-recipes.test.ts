import {
	savedViewDataSourceAccess,
	validateRyotQLDocument,
} from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { Result } from "@ryot-app/plugin-kit/effect";
import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { describe, expect, it } from "vitest";

import { ryotqlDocumentNodes } from "../tests/ryotql-test-utils";
import {
	episodicEarlierUnwatchedRecipe,
	mediaActivityLogContextRecipe,
	showSeasonEpisodeChoicesRecipe,
} from "./activity-log-recipes";

const reference = { kind: "self" } as const;

const rows = (items: readonly Record<string, unknown>[]) =>
	rowsResult(items, { limit: 100, hasMore: false, nextCursor: null });

const includeRows = (items: readonly Record<string, unknown>[]) => ({
	items,
	pageInfo: { limit: 100, hasMore: false },
});

const aggregateRows = (consumedOn: readonly string[]) => ({
	type: "aggregate" as const,
	pageInfo: { limit: 10, hasMore: false },
	items: consumedOn.map((value) => ({ consumedOn: value, lastUsedAt: "2026-03-01T00:00:00.000Z" })),
});

const targetRow = (overrides: Record<string, unknown> = {}) => ({
	pages: null,
	runtime: null,
	id: "entity-1",
	name: "Entity",
	chapters: null,
	episodes: null,
	position: null,
	state: "untracked",
	schemaSlug: "movie",
	watchProviders: null,
	progressPercent: null,
	seasons: includeRows([]),
	populationStatus: "ready",
	translationStatus: "none",
	showNextUp: includeRows([]),
	podcastNextUp: includeRows([]),
	...overrides,
});

const decodeContext = (
	target: Record<string, unknown> | undefined,
	entityConsumedOn: readonly string[] = [],
	recentConsumedOn: readonly string[] = [],
) =>
	mediaActivityLogContextRecipe({ reference, entityId: "entity-1" }).decode({
		data: {
			entityConsumedOn: aggregateRows(entityConsumedOn),
			recentConsumedOn: aggregateRows(recentConsumedOn),
			target: rows(target === undefined ? [] : [target]),
		},
	});

const valid = (recipe: { readonly document: Parameters<typeof validateRyotQLDocument>[0] }) =>
	expect(validateRyotQLDocument(recipe.document, savedViewDataSourceAccess)).toBeNull();

describe("media activity log context recipe", () => {
	it("validates the document", () => {
		valid(mediaActivityLogContextRecipe({ reference, entityId: "entity-1" }));
	});

	it("scopes suggestions to the entity first and to its schema's episodes for shows and podcasts", () => {
		const { queries } = mediaActivityLogContextRecipe({ reference, entityId: "entity-1" }).document;
		const entityNodes = ryotqlDocumentNodes([queries["entityConsumedOn"]]);
		const recentNodes = ryotqlDocumentNodes([queries["recentConsumedOn"]]);
		expect(entityNodes).toContainEqual({ type: "literal", value: "show-episode" });
		expect(entityNodes).toContainEqual({ type: "literal", value: "podcast-episode" });
		expect(entityNodes).toContainEqual(
			expect.objectContaining({ type: "column", field: "sessionEntityId" }),
		);
		expect(recentNodes).not.toContainEqual(
			expect.objectContaining({ type: "column", field: "sessionEntityId" }),
		);
		expect(queries["entityConsumedOn"]?.output).toMatchObject({ limit: 10, type: "aggregate" });
		expect(queries["recentConsumedOn"]?.output).toMatchObject({ limit: 5, type: "aggregate" });
	});

	it("is empty for an entity that is not visible media", () => {
		expect(Result.getOrThrow(decodeContext(undefined))).toBeNull();
	});

	it("lists this entity's sources before recent ones without repeats", () => {
		const context = Result.getOrThrow(
			decodeContext(targetRow(), ["Netflix", "Plex"], ["Plex", "Hulu", "Netflix"]),
		);
		expect(context?.consumedOn).toEqual(["Netflix", "Plex", "Hulu"]);
	});

	it("returns position, percent and the show's next-up episode with its seasons", () => {
		const nextUp = { name: "Four", id: "episode-4", seasonNumber: 2, episodeNumber: 4 };
		const context = Result.getOrThrow(
			decodeContext(
				targetRow({
					position: 7,
					schemaSlug: "show",
					state: "in_progress",
					progressPercent: 58.33,
					showNextUp: includeRows([nextUp]),
					seasons: includeRows([{ id: "season-1", seasonNumber: 1, name: "Season 1" }]),
				}),
			),
		);
		expect(context).toMatchObject({
			nextUp,
			position: 7,
			progressPercent: 58.33,
			seasons: [{ id: "season-1", seasonNumber: 1, name: "Season 1" }],
		});
	});

	it("falls back to the podcast next-up episode", () => {
		const nextUp = { name: "Nine", id: "episode-9", episodeNumber: 9, seasonNumber: null };
		const context = Result.getOrThrow(
			decodeContext(targetRow({ schemaSlug: "podcast", podcastNextUp: includeRows([nextUp]) })),
		);
		expect(context?.nextUp).toEqual(nextUp);
	});

	it("has no next-up episode for flat media", () => {
		expect(Result.getOrThrow(decodeContext(targetRow()))?.nextUp).toBeNull();
	});
});

describe("show season episode choices recipe", () => {
	const recipe = showSeasonEpisodeChoicesRecipe({
		reference,
		limit: 100,
		seasonNumber: 2,
		showEntityId: "show-1",
	});

	it("validates the document", () => {
		valid(recipe);
	});

	it("selects one season's episodes in episode order, specials and unaired included", () => {
		const nodes = ryotqlDocumentNodes([recipe.document]);
		expect(nodes).toContainEqual({ value: 2, type: "literal" });
		expect(nodes).toContainEqual({ type: "literal", value: "show-1" });
		expect(nodes).not.toContainEqual({ type: "currentDate" });
		expect(recipe.document.queries["episodes"]?.output).toMatchObject({
			orderBy: [
				{ direction: "asc", expr: expect.objectContaining({ type: "cast", target: "number" }) },
				{ direction: "asc", expr: expect.objectContaining({ field: "id" }) },
			],
		});
	});

	it("decodes the labelled choices", () => {
		const choice = {
			name: "Pilot",
			id: "episode-1",
			episodeNumber: 1,
			state: "complete",
			publishDate: "2024-01-01",
		};
		expect(Result.getOrThrow(recipe.decode({ data: { episodes: rows([choice]) } })).items).toEqual([
			choice,
		]);
	});
});

describe("episodic earlier unwatched recipe", () => {
	const showRecipe = episodicEarlierUnwatchedRecipe({
		reference,
		limit: 100,
		kind: "show",
		parentEntityId: "show-1",
		episodeEntityId: "episode-5",
	});
	const podcastRecipe = episodicEarlierUnwatchedRecipe({
		reference,
		limit: 100,
		kind: "podcast",
		parentEntityId: "podcast-1",
		episodeEntityId: "episode-5",
	});

	it("validates the documents", () => {
		valid(showRecipe);
		valid(podcastRecipe);
	});

	it("limits a show to regular, aired, not-yet-complete episodes before the selected one", () => {
		const nodes = ryotqlDocumentNodes([showRecipe.document.queries["episodes"]?.where]);
		expect(nodes).toContainEqual({ type: "literal", value: "complete" });
		expect(nodes).toContainEqual(expect.objectContaining({ operator: "neq", type: "comparison" }));
		expect(nodes).toContainEqual({ type: "currentDate" });
		expect(nodes).toContainEqual(
			expect.objectContaining({
				operator: "gt",
				type: "comparison",
				right: { value: 0, type: "literal" },
			}),
		);
		expect(nodes).toContainEqual({ type: "literal", value: "episode-5" });
		expect(nodes).toContainEqual(expect.objectContaining({ type: "first" }));
	});

	it("orders a show across seasons and a podcast by episode number", () => {
		const showOrder = showRecipe.document.queries["episodes"]?.output;
		const podcastOrder = podcastRecipe.document.queries["episodes"]?.output;
		expect(showOrder).toMatchObject({ orderBy: [{}, {}, {}] });
		expect(podcastOrder).toMatchObject({ orderBy: [{}, {}] });
		expect(
			ryotqlDocumentNodes([podcastRecipe.document.queries["episodes"]?.where]),
		).not.toContainEqual({ type: "literal", value: "show-season" });
	});

	it("reports the earlier episodes and whether more exist", () => {
		const earlier = { name: "One", id: "episode-1", seasonNumber: 1, episodeNumber: 1 };
		expect(
			Result.getOrThrow(
				showRecipe.decode({
					data: {
						episodes: rowsResult([earlier], { limit: 100, hasMore: true, nextCursor: "next" }),
					},
				}),
			),
		).toEqual({ hasMore: true, items: [earlier], nextCursor: "next" });
	});
});
