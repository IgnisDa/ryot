import { dayjs } from "@ryot/ts-utils/dayjs";

import {
	assertRequiredHeaders,
	createBacklogEvent,
	finalizeEntityGroups,
} from "../../media/book/shared";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/import-processor";
import { parseCsvText } from "../../runtime/csv";

const getEntitySchemaSlug = (titleType: string): "movie" | "show" | undefined => {
	if (["Movie", "Video", "movie", "video"].includes(titleType)) {
		return "movie";
	}
	if (["TV Series", "TV Mini Series", "tvSeries", "tvMiniSeries"].includes(titleType)) {
		return "show";
	}
	return undefined;
};

export const adaptImdbCsv = (csvText: string): MediaImportAdapterResult => {
	const { headers, rows } = parseCsvText(csvText);
	assertRequiredHeaders(headers, ["Const", "Title Type"], "IMDb");

	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ReturnType<typeof getOrCreateMediaEntityGroup>>();
	const importedAt = dayjs().toISOString();

	for (let itemIndex = 0; itemIndex < rows.length; itemIndex++) {
		const row = rows[itemIndex];
		if (!row) {
			continue;
		}

		const imdbId = row.Const?.trim() ?? "";
		const title = row.Title?.trim();
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

	return { entityGroups: finalizeEntityGroups(groupMap), failures };
};
