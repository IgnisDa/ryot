import { parseCsvText } from "./csv";
import { getOrCreateMediaEntityGroup, type ImportMediaEntityGroupBuilder } from "./groups";
import { addCollectionMembership, assertRequiredHeaders, finalizeEntityGroups } from "./helpers";
import type { MediaImportAdapterFailure } from "./schemas";

export const adaptIgdbCsv = (csvText: string, input: { collection: string }) => {
	const { headers, rows } = parseCsvText(csvText);
	assertRequiredHeaders(headers, ["id", "game"], "IGDB");
	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ImportMediaEntityGroupBuilder>();
	for (let itemIndex = 0; itemIndex < rows.length; itemIndex++) {
		const row = rows[itemIndex];
		if (!row) {
			continue;
		}
		const externalId = row["id"]?.trim() ?? "";
		const sourceName = row["game"]?.trim();
		const sourceLabel = sourceName?.length ? sourceName : `IGDB row ${itemIndex + 1}`;
		if (!externalId) {
			failures.push({ itemIndex, sourceLabel, message: "id is empty" });
			continue;
		}
		const group = getOrCreateMediaEntityGroup(
			groupMap,
			{
				externalId,
				sourceLabel,
				kind: "resolved",
				providerSlug: "video-game.igdb",
				entitySchemaSlug: "video-game",
			},
			itemIndex,
		);
		addCollectionMembership(group, input.collection);
	}
	return {
		totalItems: rows.length,
		entityGroups: finalizeEntityGroups(groupMap.values()),
		failures,
	};
};
