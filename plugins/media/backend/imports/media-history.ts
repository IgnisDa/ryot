import { Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { MediaHistoryItem } from "../../shared/media-history";
import type {
	ImportMediaEntityGroup,
	ImportMediaEvent,
	MediaImportAdapterFailure,
} from "./schemas";

const decodeMediaHistoryItem = Schema.decodeUnknownResult(MediaHistoryItem);

export const adaptMediaHistoryBatch = (
	rows: ReadonlyArray<unknown>,
	eventStart = 0,
	eventLimit = Number.MAX_SAFE_INTEGER,
) => {
	const failures: MediaImportAdapterFailure[] = [];
	const entityGroups: ImportMediaEntityGroup[] = [];
	let nextEventOffset = 0;
	for (const [itemIndex, row] of rows.entries()) {
		const decoded = decodeMediaHistoryItem(row);
		if (Result.isFailure(decoded)) {
			failures.push({ itemIndex, message: "Media history item is malformed" });
			continue;
		}
		const item = decoded.success;
		const events: ImportMediaEvent[] = [];
		for (const { episode, ...event } of item.events.slice(eventStart, eventStart + eventLimit)) {
			events.push(episode === undefined ? event : { ...event, unresolvedEpisode: episode });
		}
		entityGroups.push({
			events,
			itemIndex,
			collectionMemberships: [],
			entityRef: {
				kind: "resolved",
				sourceLabel: item.title,
				externalId: item.externalId,
				providerSlug: item.providerSlug,
				entitySchemaSlug: item.entitySchemaSlug,
			},
		});
		nextEventOffset = eventStart + eventLimit < item.events.length ? eventStart + eventLimit : 0;
	}
	return { failures, entityGroups, nextEventOffset, totalItems: rows.length };
};
