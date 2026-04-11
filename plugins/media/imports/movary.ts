import { Either } from "@ryot/sandbox-sdk/effect";

import { parseCsvText } from "./csv";
import { parseDateTime } from "./dates";
import { getOrCreateMediaEntityGroup, type ImportMediaEntityGroupBuilder } from "./groups";
import {
	createBacklogEvent,
	createCompleteEvent,
	createReviewEvent,
	finalizeEntityGroups,
} from "./helpers";
import type { MediaImportAdapterFailure } from "./schemas";

const TITLE_ALIASES = ["title"];
const COMMENT_ALIASES = ["comment"];
const TMDB_ID_ALIASES = ["tmdb_id", "tmdbId"];
const RATING_ALIASES = ["user_rating", "userRating"];
const HISTORY_DATE_ALIASES = ["watched_at", "watchedAt"];
const MOVARY_DATE_FORMATS = ["YYYY-MM-DD", "YYYY-MM-DD HH:mm:ss"];

const normalizeHeader = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[\s_-]+/g, "");

const readCell = (row: Record<string, string>, aliases: string[]) => {
	for (const [key, value] of Object.entries(row)) {
		if (aliases.some((alias) => normalizeHeader(alias) === normalizeHeader(key))) {
			return value.trim() || undefined;
		}
	}
	return undefined;
};

const readRequiredCell = (row: Record<string, string>, aliases: string[], label: string) => {
	const value = readCell(row, aliases);
	if (!value) {
		throw new Error(`Row is missing ${label}`);
	}
	return value;
};

const assertHeaders = (
	headers: string[],
	required: Array<{ label: string; aliases: string[] }>,
	fileLabel: string,
) => {
	if (headers.length === 0) {
		throw new Error(`${fileLabel} CSV is empty or has no header row`);
	}
	const normalized = new Set(headers.map(normalizeHeader));
	const missing = required
		.filter(({ aliases }) => !aliases.some((alias) => normalized.has(normalizeHeader(alias))))
		.map(({ label }) => label);
	if (missing.length > 0) {
		throw new Error(`${fileLabel} CSV is missing required columns: ${missing.join(", ")}`);
	}
};

const sourceLabel = (title: string | undefined, file: string, index: number) => {
	const trimmed = title?.trim();
	if (trimmed) {
		return trimmed;
	}
	return `Movary ${file} row ${index + 1}`;
};

const tmdbId = (row: Record<string, string>) => {
	const value = readRequiredCell(row, TMDB_ID_ALIASES, "TMDB id");
	if (!/^\d+$/.test(value)) {
		throw new Error("TMDB id must be numeric");
	}
	return value;
};

const rating = (value: string) => {
	const parsed = Number.parseFloat(value.trim().replace(",", "."));
	if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10) {
		throw new Error("user_rating must be a number between 0 and 10");
	}
	return Math.round(parsed * 1000) / 100;
};

const movieGroup = (
	groups: Map<string, ImportMediaEntityGroupBuilder>,
	input: { itemIndex: number; sourceLabel: string; tmdbId: string },
) =>
	getOrCreateMediaEntityGroup(
		groups,
		{
			kind: "resolved",
			providerSlug: "movie.tmdb",
			externalId: input.tmdbId,
			entitySchemaSlug: "movie",
			sourceLabel: input.sourceLabel,
		},
		input.itemIndex,
	);

const pushFailure = (
	failures: MediaImportAdapterFailure[],
	input: {
		error: unknown;
		itemIndex: number;
		fileLabel: string;
		sourceLabel: string;
		sourceIdentifier?: string | undefined;
	},
) => {
	failures.push({
		itemIndex: input.itemIndex,
		sourceLabel: input.sourceLabel,
		...(input.sourceIdentifier ? { sourceIdentifier: input.sourceIdentifier } : {}),
		message: `${input.fileLabel} file: ${input.error instanceof Error ? input.error.message : "Movary row is malformed"}`,
	});
};

export const adaptMovaryExports = (input: {
	historyCsv: string;
	importedAt: string;
	ratingsCsv: string;
	watchlistCsv: string;
}) => {
	const failures: MediaImportAdapterFailure[] = [];
	const groups = new Map<string, ImportMediaEntityGroupBuilder>();
	let itemIndex = 0;

	const history = parseCsvText(input.historyCsv);
	assertHeaders(
		history.headers,
		[
			{ label: "title", aliases: TITLE_ALIASES },
			{ label: "tmdb_id", aliases: TMDB_ID_ALIASES },
			{ label: "watched_at", aliases: HISTORY_DATE_ALIASES },
		],
		"Movary history",
	);
	for (const row of history.rows) {
		const index = itemIndex++;
		const label = sourceLabel(readCell(row, TITLE_ALIASES), "history", index);
		const identifier = readCell(row, TMDB_ID_ALIASES);
		const parsed = Either.try(() => {
			const occurredAt = parseDateTime(
				readRequiredCell(row, HISTORY_DATE_ALIASES, "watched_at"),
				MOVARY_DATE_FORMATS,
			);
			if (!occurredAt) {
				throw new Error("watched_at is invalid");
			}
			const group = movieGroup(groups, {
				itemIndex: index,
				sourceLabel: label,
				tmdbId: tmdbId(row),
			});
			group.events.push(createCompleteEvent({ occurredAt, completedOn: occurredAt }));
			const comment = readCell(row, COMMENT_ALIASES);
			const review = createReviewEvent({ occurredAt, ...(comment ? { text: comment } : {}) });
			if (review) {
				group.events.push(review);
			}
		});
		if (Either.isLeft(parsed)) {
			pushFailure(failures, {
				error: parsed.left,
				itemIndex: index,
				fileLabel: "History",
				sourceLabel: label,
				sourceIdentifier: identifier,
			});
		}
	}

	const ratings = parseCsvText(input.ratingsCsv);
	assertHeaders(
		ratings.headers,
		[
			{ label: "title", aliases: TITLE_ALIASES },
			{ label: "tmdb_id", aliases: TMDB_ID_ALIASES },
			{ label: "user_rating", aliases: RATING_ALIASES },
		],
		"Movary ratings",
	);
	for (const row of ratings.rows) {
		const index = itemIndex++;
		const label = sourceLabel(readCell(row, TITLE_ALIASES), "ratings", index);
		const identifier = readCell(row, TMDB_ID_ALIASES);
		const parsed = Either.try(() => {
			const id = tmdbId(row);
			const normalizedRating = rating(readRequiredCell(row, RATING_ALIASES, "user_rating"));
			const group = movieGroup(groups, { itemIndex: index, sourceLabel: label, tmdbId: id });
			group.events.push({
				properties: { rating: normalizedRating },
				eventSchemaSlug: "review",
				occurredAt: input.importedAt,
			});
		});
		if (Either.isLeft(parsed)) {
			pushFailure(failures, {
				error: parsed.left,
				itemIndex: index,
				fileLabel: "Ratings",
				sourceLabel: label,
				sourceIdentifier: identifier,
			});
		}
	}

	const watchlist = parseCsvText(input.watchlistCsv);
	assertHeaders(
		watchlist.headers,
		[
			{ label: "title", aliases: TITLE_ALIASES },
			{ label: "tmdb_id", aliases: TMDB_ID_ALIASES },
		],
		"Movary watchlist",
	);
	for (const row of watchlist.rows) {
		const index = itemIndex++;
		const label = sourceLabel(readCell(row, TITLE_ALIASES), "watchlist", index);
		const identifier = readCell(row, TMDB_ID_ALIASES);
		const parsed = Either.try(() => {
			const group = movieGroup(groups, {
				itemIndex: index,
				sourceLabel: label,
				tmdbId: tmdbId(row),
			});
			group.events.push(createBacklogEvent(input.importedAt));
		});
		if (Either.isLeft(parsed)) {
			pushFailure(failures, {
				error: parsed.left,
				itemIndex: index,
				fileLabel: "Watchlist",
				sourceLabel: label,
				sourceIdentifier: identifier,
			});
		}
	}

	return { totalItems: itemIndex, entityGroups: finalizeEntityGroups(groups.values()), failures };
};
