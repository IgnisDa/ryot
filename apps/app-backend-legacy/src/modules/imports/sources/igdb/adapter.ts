import {
	addCollectionMembership,
	assertRequiredHeaders,
	finalizeEntityGroups,
} from "../../media/book/shared";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/import-processor";
import { parseCsvText } from "../../runtime/csv";

export const adaptIgdbCsv = (
	csvText: string,
	input: { collection: string },
): MediaImportAdapterResult => {
	const { headers, rows } = parseCsvText(csvText);
	assertRequiredHeaders(headers, ["id", "game"], "IGDB");

	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ReturnType<typeof getOrCreateMediaEntityGroup>>();

	for (let itemIndex = 0; itemIndex < rows.length; itemIndex++) {
		const row = rows[itemIndex];
		if (!row) {
			continue;
		}

		const externalId = row.id?.trim() ?? "";
		const sourceName = row.game?.trim();
		const sourceLabel = sourceName?.length ? sourceName : `IGDB row ${itemIndex + 1}`;
		if (!externalId) {
			failures.push({ itemIndex, sourceLabel, message: "id is empty" });
			continue;
		}

		const group = getOrCreateMediaEntityGroup(
			groupMap,
			{
				sourceLabel,
				externalId,
				kind: "resolved",
				scriptSlug: "video-game.igdb",
				entitySchemaSlug: "video-game",
			},
			itemIndex,
		);
		addCollectionMembership(group, input.collection);
	}

	return { entityGroups: finalizeEntityGroups(groupMap), failures };
};
