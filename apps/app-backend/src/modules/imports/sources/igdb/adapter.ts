import {
	addCollectionMembership,
	assertRequiredHeaders,
	finalizeEntityGroups,
} from "../../media/adapter-helpers";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/adapter-result";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type { ImportMediaEntityGroup } from "../../media/types";
import { parseCsvText } from "../../runtime/csv";

export const adaptIgdbCsv = (
	csvText: string,
	input: { collection: string },
): MediaImportAdapterResult => {
	const { headers, rows } = parseCsvText(csvText);
	assertRequiredHeaders(headers, ["id", "game"], "IGDB");

	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ImportMediaEntityGroup>();

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
				externalId,
				sourceLabel,
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
