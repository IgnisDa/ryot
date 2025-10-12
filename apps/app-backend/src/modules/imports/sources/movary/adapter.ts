import { dayjs } from "@ryot/ts-utils/dayjs";

import {
	createBacklogEvent,
	createCompleteEvent,
	createReviewEvent,
	finalizeEntityGroups,
	parseDateTime,
} from "../../media/book/shared";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/import-processor";
import {
	normalizeCsvHeader,
	parseCsvText,
	readCsvCell,
	readRequiredCsvCell,
} from "../../runtime/csv";

type MovaryImportAdapterDeps = {
	now: () => string;
};

type MovaryRequiredColumn = {
	label: string;
	aliases: string[];
};

const TITLE_ALIASES = ["title"];
const COMMENT_ALIASES = ["comment"];
const TMDB_ID_ALIASES = ["tmdb_id", "tmdbId"];
const RATING_ALIASES = ["user_rating", "userRating"];
const HISTORY_DATE_ALIASES = ["watched_at", "watchedAt"];
const MOVARY_DATE_FORMATS = ["YYYY-MM-DD", "YYYY-MM-DD HH:mm:ss"];

const movaryImportAdapterDeps: MovaryImportAdapterDeps = {
	now: () => dayjs().toISOString(),
};

const movaryHeaders = {
	history: [
		{ label: "title", aliases: TITLE_ALIASES },
		{ label: "tmdb_id", aliases: TMDB_ID_ALIASES },
		{ label: "watched_at", aliases: HISTORY_DATE_ALIASES },
	],
	ratings: [
		{ label: "title", aliases: TITLE_ALIASES },
		{ label: "tmdb_id", aliases: TMDB_ID_ALIASES },
		{ label: "user_rating", aliases: RATING_ALIASES },
	],
	watchlist: [
		{ label: "title", aliases: TITLE_ALIASES },
		{ label: "tmdb_id", aliases: TMDB_ID_ALIASES },
	],
} satisfies Record<string, MovaryRequiredColumn[]>;

const assertRequiredMovaryHeaders = (
	headers: string[],
	required: MovaryRequiredColumn[],
	fileLabel: string,
): void => {
	if (headers.length === 0) {
		throw new Error(`${fileLabel} CSV is empty or has no header row`);
	}

	const normalizedHeaders = new Set(headers.map(normalizeCsvHeader));
	const missing = required
		.filter(
			(column) => !column.aliases.some((alias) => normalizedHeaders.has(normalizeCsvHeader(alias))),
		)
		.map((column) => column.label);
	if (missing.length > 0) {
		throw new Error(`${fileLabel} CSV is missing required columns: ${missing.join(", ")}`);
	}
};

const getSourceLabel = (
	title: string | undefined,
	fileLabel: string,
	itemIndex: number,
): string => {
	const trimmed = title?.trim();
	return trimmed?.length ? trimmed : `Movary ${fileLabel} row ${itemIndex + 1}`;
};

const getTmdbId = (row: Record<string, string>): string => {
	const tmdbId = readRequiredCsvCell(row, TMDB_ID_ALIASES, "TMDB id");
	if (!/^\d+$/.test(tmdbId)) {
		throw new Error("TMDB id must be numeric");
	}
	return tmdbId;
};

const normalizeMovaryRating = (value: string): number => {
	const normalized = value.trim().replace(",", ".");
	const parsed = Number.parseFloat(normalized);
	if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10) {
		throw new Error("user_rating must be a number between 0 and 10");
	}
	return Math.round(parsed * 1000) / 100;
};

const getHistoryOccurredAt = (row: Record<string, string>): string => {
	const watchedAt = readRequiredCsvCell(row, HISTORY_DATE_ALIASES, "watched_at");
	const occurredAt = parseDateTime(watchedAt, MOVARY_DATE_FORMATS);
	if (!occurredAt) {
		throw new Error("watched_at is invalid");
	}
	return occurredAt;
};

const getMovieGroup = (
	groupMap: Map<string, ReturnType<typeof getOrCreateMediaEntityGroup>>,
	input: { itemIndex: number; sourceLabel: string; tmdbId: string },
) =>
	getOrCreateMediaEntityGroup(
		groupMap,
		{
			kind: "resolved",
			scriptSlug: "movie.tmdb",
			externalId: input.tmdbId,
			entitySchemaSlug: "movie",
			sourceLabel: input.sourceLabel,
		},
		input.itemIndex,
	);

const pushMovaryFailure = (
	failures: MediaImportAdapterFailure[],
	input: {
		error: unknown;
		itemIndex: number;
		fileLabel: string;
		sourceLabel: string;
		sourceIdentifier?: string;
	},
): void => {
	failures.push({
		itemIndex: input.itemIndex,
		sourceLabel: input.sourceLabel,
		...(input.sourceIdentifier ? { sourceIdentifier: input.sourceIdentifier } : {}),
		message: `${input.fileLabel} file: ${input.error instanceof Error ? input.error.message : "Movary row is malformed"}`,
	});
};

const adaptHistoryCsv = (
	groupMap: Map<string, ReturnType<typeof getOrCreateMediaEntityGroup>>,
	failures: MediaImportAdapterFailure[],
	csvText: string,
	startItemIndex: number,
): number => {
	const { headers, rows } = parseCsvText(csvText);
	assertRequiredMovaryHeaders(headers, movaryHeaders.history, "Movary history");

	let itemIndex = startItemIndex;
	for (const row of rows) {
		const title = readCsvCell(row, TITLE_ALIASES);
		const sourceIdentifier = readCsvCell(row, TMDB_ID_ALIASES);
		const sourceLabel = getSourceLabel(title, "history", itemIndex);

		try {
			const tmdbId = getTmdbId(row);
			const occurredAt = getHistoryOccurredAt(row);
			const group = getMovieGroup(groupMap, { itemIndex, sourceLabel, tmdbId });

			group.events.push(createCompleteEvent({ occurredAt, completedOn: occurredAt }));

			const reviewEvent = createReviewEvent({
				occurredAt,
				text: readCsvCell(row, COMMENT_ALIASES),
			});
			if (reviewEvent) {
				group.events.push(reviewEvent);
			}
		} catch (error) {
			pushMovaryFailure(failures, {
				error,
				itemIndex,
				sourceLabel,
				sourceIdentifier,
				fileLabel: "History",
			});
		}

		itemIndex++;
	}

	return itemIndex;
};

const adaptRatingsCsv = (
	groupMap: Map<string, ReturnType<typeof getOrCreateMediaEntityGroup>>,
	failures: MediaImportAdapterFailure[],
	input: { csvText: string; itemIndex: number; importedAt: string },
): number => {
	const { headers, rows } = parseCsvText(input.csvText);
	assertRequiredMovaryHeaders(headers, movaryHeaders.ratings, "Movary ratings");

	let itemIndex = input.itemIndex;
	for (const row of rows) {
		const title = readCsvCell(row, TITLE_ALIASES);
		const sourceIdentifier = readCsvCell(row, TMDB_ID_ALIASES);
		const sourceLabel = getSourceLabel(title, "ratings", itemIndex);

		try {
			const tmdbId = getTmdbId(row);
			const ratingValue = readRequiredCsvCell(row, RATING_ALIASES, "user_rating");
			const rating = normalizeMovaryRating(ratingValue);
			const group = getMovieGroup(groupMap, { itemIndex, sourceLabel, tmdbId });
			group.events.push({
				properties: { rating },
				eventSchemaSlug: "review",
				occurredAt: input.importedAt,
			});
		} catch (error) {
			pushMovaryFailure(failures, {
				error,
				itemIndex,
				sourceLabel,
				sourceIdentifier,
				fileLabel: "Ratings",
			});
		}

		itemIndex++;
	}

	return itemIndex;
};

const adaptWatchlistCsv = (
	groupMap: Map<string, ReturnType<typeof getOrCreateMediaEntityGroup>>,
	failures: MediaImportAdapterFailure[],
	input: { csvText: string; itemIndex: number; importedAt: string },
): number => {
	const { headers, rows } = parseCsvText(input.csvText);
	assertRequiredMovaryHeaders(headers, movaryHeaders.watchlist, "Movary watchlist");

	let itemIndex = input.itemIndex;
	for (const row of rows) {
		const title = readCsvCell(row, TITLE_ALIASES);
		const sourceIdentifier = readCsvCell(row, TMDB_ID_ALIASES);
		const sourceLabel = getSourceLabel(title, "watchlist", itemIndex);

		try {
			const tmdbId = getTmdbId(row);
			const group = getMovieGroup(groupMap, { itemIndex, sourceLabel, tmdbId });
			group.events.push(createBacklogEvent(input.importedAt));
		} catch (error) {
			pushMovaryFailure(failures, {
				error,
				itemIndex,
				sourceLabel,
				sourceIdentifier,
				fileLabel: "Watchlist",
			});
		}

		itemIndex++;
	}

	return itemIndex;
};

export const adaptMovaryExports = (
	input: { historyCsv: string; ratingsCsv: string; watchlistCsv: string },
	deps: MovaryImportAdapterDeps = movaryImportAdapterDeps,
): MediaImportAdapterResult => {
	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ReturnType<typeof getOrCreateMediaEntityGroup>>();
	const importedAt = deps.now();

	let itemIndex = 0;
	itemIndex = adaptHistoryCsv(groupMap, failures, input.historyCsv, itemIndex);
	itemIndex = adaptRatingsCsv(groupMap, failures, {
		itemIndex,
		importedAt,
		csvText: input.ratingsCsv,
	});
	adaptWatchlistCsv(groupMap, failures, {
		itemIndex,
		importedAt,
		csvText: input.watchlistCsv,
	});

	return { entityGroups: finalizeEntityGroups(groupMap), failures };
};
