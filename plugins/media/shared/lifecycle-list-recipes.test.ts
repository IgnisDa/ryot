import {
	savedViewDataSourceAccess,
	validateRyotQLDocument,
} from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { Result } from "@ryot-app/plugin-kit/effect";
import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { describe, expect, it } from "vitest";

import { podcastEpisodicKindConfig, showEpisodicKindConfig } from "./lifecycle-expressions";
import {
	episodicByLifecycleStateRecipe,
	flatByLifecycleStateRecipe,
} from "./lifecycle-list-recipes";

const identity = { images: null, populationStatus: "ready", translationStatus: "none" };

const nextUpEpisode = {
	...identity,
	runtime: 45,
	id: "episode-5",
	seasonNumber: 2,
	episodeNumber: 5,
	name: "Episode 5",
	description: null,
	state: "untracked",
	publishDate: "2026-01-01",
	schemaSlug: "show-episode",
};

const showRow = (nextUp: readonly unknown[]) => ({
	...identity,
	id: "show-1",
	name: "Severance",
	schemaSlug: "show",
	state: "in_progress",
	latestActivityAt: "2026-05-01T10:00:00.000Z",
	nextUp: { items: nextUp, pageInfo: { limit: 1, hasMore: false } },
});

const episodicWhere = (entityId?: string) =>
	JSON.stringify(
		episodicByLifecycleStateRecipe({
			limit: 1,
			states: ["backlog"],
			config: showEpisodicKindConfig,
			...(entityId === undefined ? {} : { entityId }),
		}).document.queries["items"]?.where,
	);

const nextUpSeason = (config: typeof showEpisodicKindConfig | typeof podcastEpisodicKindConfig) => {
	const query = episodicByLifecycleStateRecipe({ config, limit: 1, states: ["in_progress"] })
		.document.queries["items"];
	if (query?.output.type !== "rows") {
		throw new Error("Expected the items rows query");
	}
	return query.output.include?.[0]?.fields.find(
		(field) => "key" in field && field.key === "seasonNumber",
	);
};

describe("episodic lifecycle list recipe", () => {
	it.each([showEpisodicKindConfig, podcastEpisodicKindConfig])(
		"validates the $kind document with its next-up include",
		(config) => {
			const recipe = episodicByLifecycleStateRecipe({
				config,
				limit: 20,
				after: "cursor",
				entityId: "parent-1",
				states: ["in_progress", "caught_up"],
			});
			expect(validateRyotQLDocument(recipe.document, savedViewDataSourceAccess)).toBeNull();
		},
	);

	it("narrows to one entity only when asked", () => {
		expect(episodicWhere("show-1")).toContain('"value":"show-1"');
		expect(episodicWhere()).not.toContain('"value":"show-1"');
	});

	it("selects no season number from podcast episodes", () => {
		expect(nextUpSeason(podcastEpisodicKindConfig)).toMatchObject({
			expr: { value: null, type: "literal" },
		});
		expect(nextUpSeason(showEpisodicKindConfig)).toMatchObject({ expr: { type: "cast" } });
	});

	it("flattens the next-up include to one episode or null", () => {
		const recipe = episodicByLifecycleStateRecipe({
			limit: 2,
			states: ["in_progress"],
			config: showEpisodicKindConfig,
		});
		const decoded = Result.getOrThrow(
			recipe.decode({
				data: {
					items: rowsResult([showRow([nextUpEpisode]), { ...showRow([]), id: "show-2" }], {
						limit: 2,
						hasMore: true,
						nextCursor: "next",
					}),
				},
			}),
		);

		expect(decoded.pageInfo).toMatchObject({ hasMore: true, nextCursor: "next" });
		expect(decoded.items.map((item) => [item.id, item.nextUp?.id ?? null])).toEqual([
			["show-1", "episode-5"],
			["show-2", null],
		]);
	});
});

describe("flat lifecycle list recipe", () => {
	it("validates the cross-schema document", () => {
		const recipe = flatByLifecycleStateRecipe({ limit: 20, states: ["in_progress", "backlog"] });
		expect(validateRyotQLDocument(recipe.document, savedViewDataSourceAccess)).toBeNull();
	});

	it("reads every flat builtin schema and neither episodic one", () => {
		const where = JSON.stringify(
			flatByLifecycleStateRecipe({ limit: 1, states: ["backlog"] }).document.queries["items"]
				?.where,
		);

		expect(where).toContain('"value":"anime"');
		expect(where).toContain('"value":"manga"');
		expect(where).not.toContain('"value":"show"');
		expect(where).not.toContain('"value":"podcast"');
	});
});
