import { parseCsvText } from "./csv";
import { nowIso, parseDateWithFormat } from "./dates";
import { getOrCreateMediaEntityGroup, type ImportMediaEntityGroupBuilder } from "./groups";
import {
	assertRequiredHeaders,
	createBacklogEvent,
	createCompleteEvent,
	createReviewEvent,
	finalizeEntityGroups,
} from "./helpers";
import type { MediaImportAdapterFailure } from "./schemas";

const getEntitySchemaSlug = (titleType: string) => {
	if (["Movie", "Video", "movie", "video"].includes(titleType)) {
		return "movie" as const;
	}
	if (["TV Series", "TV Mini Series", "tvSeries", "tvMiniSeries"].includes(titleType)) {
		return "show" as const;
	}
	return undefined;
};

export const adaptImdbCsv = (csvText: string) => {
	const { rows, headers } = parseCsvText(csvText);
	assertRequiredHeaders(headers, ["Const", "Title Type"], "IMDb");
	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ImportMediaEntityGroupBuilder>();
	const importedAt = nowIso();
	for (let itemIndex = 0; itemIndex < rows.length; itemIndex++) {
		const row = rows[itemIndex];
		if (!row) {
			continue;
		}
		const imdbId = row["Const"]?.trim() ?? "";
		const title = row["Title"]?.trim();
		const sourceLabel = title?.length ? title : `IMDb row ${itemIndex + 1}`;
		if (!imdbId) {
			failures.push({ itemIndex, sourceLabel, message: "Const is empty" });
			continue;
		}
		const entitySchemaSlug = getEntitySchemaSlug(row["Title Type"]?.trim() ?? "");
		if (!entitySchemaSlug) {
			failures.push({
				itemIndex,
				sourceLabel,
				sourceIdentifier: imdbId,
				message: `Unknown title type: ${row["Title Type"]?.trim() ?? ""}`,
			});
			continue;
		}
		const ratingText = row["Your Rating"]?.trim() ?? "";
		const rating = ratingText ? Number(ratingText) : null;
		if (
			rating !== null &&
			(!/^[+-]?\d+(?:\.\d+)?$/.test(ratingText) || rating < 1 || rating > 10)
		) {
			failures.push({
				itemIndex,
				sourceLabel,
				sourceIdentifier: imdbId,
				message: `Invalid rating '${ratingText}', must be between 1 and 10`,
			});
			continue;
		}
		const dateRated = row["Date Rated"]?.trim() ?? "";
		const completedOn = dateRated
			? (parseDateWithFormat(dateRated, "YYYY-MM-DD") ??
				parseDateWithFormat(dateRated, "YYYY/MM/DD"))
			: null;
		if (dateRated && (!completedOn || completedOn.slice(0, 10) !== dateRated.replace(/\//g, "-"))) {
			failures.push({
				itemIndex,
				sourceLabel,
				sourceIdentifier: imdbId,
				message: `Invalid date rated '${dateRated}'`,
			});
			continue;
		}
		const group = getOrCreateMediaEntityGroup(
			groupMap,
			{
				sourceLabel,
				entitySchemaSlug,
				kind: "unresolved",
				identifierType: "imdb",
				identifierValue: imdbId,
			},
			itemIndex,
		);
		if (rating !== null || completedOn !== null) {
			const occurredAt = completedOn ?? importedAt;
			const complete = createCompleteEvent({ occurredAt, completedOn });
			group.events.push({
				...complete,
				properties: { ...complete.properties, consumedOn: "imdb" },
			});
			const review = createReviewEvent({
				occurredAt,
				rating: rating === null ? null : rating * 10,
			});
			if (review) {
				group.events.push(review);
			}
		} else {
			group.events.push(createBacklogEvent(importedAt));
		}
	}
	return {
		failures,
		totalItems: rows.length,
		entityGroups: finalizeEntityGroups(groupMap.values()),
	};
};
