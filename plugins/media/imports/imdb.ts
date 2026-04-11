import { parseCsvText } from "./csv";
import { nowIso } from "./dates";
import { getOrCreateMediaEntityGroup, type ImportMediaEntityGroupBuilder } from "./groups";
import { assertRequiredHeaders, createBacklogEvent, finalizeEntityGroups } from "./helpers";
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
	const { headers, rows } = parseCsvText(csvText);
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
		group.events.push(createBacklogEvent(importedAt));
	}
	return {
		totalItems: rows.length,
		entityGroups: finalizeEntityGroups(groupMap.values()),
		failures,
	};
};
