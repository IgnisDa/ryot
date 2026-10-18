import { Effect } from "@ryot-app/plugin-client-sdk/effect";

import { ryotqlDocumentNodes } from "../../ryotql-test-utils";
import { episodicEpisode } from "../episodic/episodes-fixture";
import { rowsResult } from "../query-result-fixture";

type Row = Record<string, unknown>;

type Pages = readonly (readonly Row[])[];

const includeRows = (items: readonly Row[]) => ({
	items,
	pageInfo: { limit: 100, hasMore: false },
});

const aggregateRows = (consumedOn: readonly string[]) => ({
	type: "aggregate" as const,
	pageInfo: { limit: 10, hasMore: false },
	items: consumedOn.map((value) => ({ consumedOn: value, lastUsedAt: "2026-03-01T00:00:00.000Z" })),
});

export const contextTarget = (overrides: Row = {}) => ({
	pages: null,
	name: "Heat",
	runtime: null,
	id: "entity-1",
	chapters: null,
	episodes: null,
	position: null,
	state: "untracked",
	schemaSlug: "movie",
	progressPercent: null,
	seasons: includeRows([]),
	showNextUp: includeRows([]),
	podcastNextUp: includeRows([]),
	translationStatus: { state: "idle", availability: "none" },
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
	...overrides,
});

export const seasonRow = (seasonNumber: number) => ({
	seasonNumber,
	id: `season-${seasonNumber}`,
	name: `Season ${seasonNumber}`,
});

export const choiceRow = (seasonNumber: number, episodeNumber: number, state = "untracked") => ({
	state,
	episodeNumber,
	publishDate: "2025-01-01",
	id: `s${seasonNumber}e${episodeNumber}`,
	name: `Episode ${episodeNumber} of ${seasonNumber}`,
});

export const earlierRow = (seasonNumber: null | number, episodeNumber: number) => ({
	seasonNumber,
	episodeNumber,
	name: `Earlier ${episodeNumber}`,
	id: seasonNumber === null ? `p${episodeNumber}` : `s${seasonNumber}e${episodeNumber}`,
});

export const podcastRow = (episodeNumber: number, state = "untracked") =>
	episodicEpisode({
		state,
		episodeNumber,
		id: `p${episodeNumber}`,
		name: `Podcast ${episodeNumber}`,
	});

export type ActivityLogFake = {
	readonly podcast?: Pages;
	readonly target?: Row | undefined;
	readonly recent?: readonly string[];
	readonly consumedOn?: readonly string[];
	readonly earlier?: Readonly<Record<string, Pages>>;
	readonly seasons?: Readonly<Record<number, Pages>>;
};

const pagedRows = (pages: Pages, documentText: string) => {
	const after = /"after":"page-(\d+)"/.exec(documentText)?.[1];
	const index = after === undefined ? 0 : Number(after);
	const hasMore = index < pages.length - 1;
	return rowsResult(pages[index] ?? [], {
		hasMore,
		limit: 100,
		nextCursor: hasMore ? `page-${index + 1}` : null,
	});
};

/** Answers the log-activity queries by recognising their document aliases. */
export const activityLogQuery =
	(fake: ActivityLogFake, requests: string[] = []) =>
	(document: unknown) => {
		const text = JSON.stringify(document);
		const nodes = ryotqlDocumentNodes(document);
		const literal = (value: unknown) =>
			nodes.some(
				(node) =>
					typeof node === "object" &&
					node !== null &&
					"type" in node &&
					node.type === "literal" &&
					"value" in node &&
					node.value === value,
			);
		if (text.includes('"logEntity"')) {
			requests.push("context");
			return Effect.succeed({
				data: {
					recentConsumedOn: aggregateRows(fake.recent ?? []),
					entityConsumedOn: aggregateRows(fake.consumedOn ?? []),
					target: rowsResult(fake.target === undefined ? [] : [fake.target], {
						limit: 1,
						hasMore: false,
						nextCursor: null,
					}),
				},
			});
		}
		if (text.includes('"choiceEpisode"')) {
			requests.push("choices");
			const season = Object.keys(fake.seasons ?? {})
				.map(Number)
				.find(literal);
			return Effect.succeed({
				data: { episodes: pagedRows(fake.seasons?.[season ?? -1] ?? [], text) },
			});
		}
		if (text.includes('"earlierEpisode"')) {
			requests.push("earlier");
			const anchor = Object.keys(fake.earlier ?? {}).find((id) => literal(id));
			return Effect.succeed({
				data: { episodes: pagedRows(fake.earlier?.[anchor ?? ""] ?? [], text) },
			});
		}
		if (text.includes('"podcastEpisodeEpisode"')) {
			requests.push("podcast");
			return Effect.succeed({ data: { episodes: pagedRows(fake.podcast ?? [], text) } });
		}
		return Effect.succeed({});
	};
