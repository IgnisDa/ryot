import { Either, Option, Schema } from "@ryot/sandbox-sdk/effect";

import { parseCsvText } from "./csv";
import { nowIso, parseDateTime, parseDateWithFormat } from "./dates";
import { getOrCreateMediaEntityGroup, type ImportMediaEntityGroupBuilder } from "./groups";
import {
	addCollectionMembership,
	assertRequiredHeaders,
	createBacklogEvent,
	createCompleteEvent,
	createDroppedEvent,
	createOnHoldEvent,
	createProgressEvent,
	createReviewEvent,
	finalizeEntityGroups,
	normalizeLifecycleStatus,
	normalizeRating,
} from "./helpers";
import type { MediaImportAdapterFailure } from "./schemas";

const GrouveeDateEntry = Schema.Struct({
	date_started: Schema.optional(Schema.NullOr(Schema.String)),
	date_finished: Schema.optional(Schema.NullOr(Schema.String)),
	seconds_played: Schema.optional(Schema.NullOr(Schema.Number)),
});
type GrouveeDateEntry = typeof GrouveeDateEntry.Type;
const GrouveeStatusEntry = Schema.Struct({
	date: Schema.optional(Schema.NullOr(Schema.String)),
	status: Schema.optional(Schema.NullOr(Schema.String)),
});
type GrouveeStatusEntry = typeof GrouveeStatusEntry.Type;
const decodeDateEntries = Schema.decodeUnknownOption(Schema.Array(GrouveeDateEntry));
const decodeStatusEntries = Schema.decodeUnknownOption(Schema.Array(GrouveeStatusEntry));
const decodeShelfRecord = Schema.decodeUnknownOption(
	Schema.Record({ key: Schema.String, value: Schema.Unknown }),
);

const parseJson = (value: string) => {
	const parsed = Either.try(() => JSON.parse(value.trim()) as unknown);
	return Either.isLeft(parsed) ? undefined : parsed.right;
};
const parseGrouveeDate = (value: string | null | undefined) => {
	const raw = value?.trim();
	return !raw || raw === "None"
		? null
		: (parseDateTime(raw, ["YYYY-MM-DDTHH:mm:ss[Z]", "YYYY-MM-DDTHH:mm:ssZ"]) ??
				parseDateWithFormat(raw, "YYYY-MM-DD"));
};
const parseShelfNames = (value: string) => {
	const parsed = parseJson(value);
	return parsed === undefined
		? []
		: Option.match(decodeShelfRecord(parsed), { onNone: () => [], onSome: Object.keys });
};
const parseDateEntries = (value: string): ReadonlyArray<GrouveeDateEntry> => {
	const parsed = parseJson(value);
	return parsed === undefined ? [] : Option.getOrElse(decodeDateEntries(parsed), () => []);
};
const parseStatusEntries = (value: string): ReadonlyArray<GrouveeStatusEntry> => {
	const parsed = parseJson(value);
	return parsed === undefined ? [] : Option.getOrElse(decodeStatusEntries(parsed), () => []);
};
const getShelfLifecycle = (shelf: string) => {
	if (shelf === "Played") {
		return "complete" as const;
	}
	if (shelf === "Playing") {
		return "progress" as const;
	}
	if (shelf === "Wish List") {
		return "backlog" as const;
	}
	return normalizeLifecycleStatus(shelf);
};

export const adaptGrouveeCsv = (csvText: string) => {
	const { headers, rows } = parseCsvText(csvText);
	assertRequiredHeaders(
		headers,
		["id", "name", "dates", "shelves", "statuses", "giantbomb_id"],
		"Grouvee",
	);
	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ImportMediaEntityGroupBuilder>();
	for (let itemIndex = 0; itemIndex < rows.length; itemIndex++) {
		const row = rows[itemIndex];
		if (!row) {
			continue;
		}
		const giantbombId = row["giantbomb_id"]?.trim() ?? "";
		const sourceName = row["name"]?.trim();
		const sourceLabel = sourceName?.length ? sourceName : `Grouvee row ${itemIndex + 1}`;
		if (!giantbombId) {
			failures.push({ itemIndex, sourceLabel, message: "giantbomb_id is empty" });
			continue;
		}
		const group = getOrCreateMediaEntityGroup(
			groupMap,
			{
				sourceLabel,
				kind: "resolved",
				entitySchemaSlug: "video-game",
				externalId: `3030-${giantbombId}`,
				providerSlug: "video-game.giant-bomb",
			},
			itemIndex,
		);
		const importedAt = nowIso();
		let hasExplicitCompletion = false;
		let lastOccurredAt: string | undefined;
		for (const entry of parseDateEntries(row["dates"] ?? "")) {
			if (!entry.date_finished) {
				continue;
			}
			const startedOn = parseGrouveeDate(entry.date_started);
			const completedOn = parseGrouveeDate(entry.date_finished);
			const occurredAt = completedOn ?? startedOn ?? importedAt;
			hasExplicitCompletion = true;
			lastOccurredAt = occurredAt;
			group.events.push(createCompleteEvent({ startedOn, completedOn, occurredAt }));
		}
		for (const statusEntry of parseStatusEntries(row["statuses"] ?? "")) {
			const text = statusEntry.status?.trim();
			if (!text) {
				continue;
			}
			const occurredAt = parseGrouveeDate(statusEntry.date) ?? importedAt;
			lastOccurredAt = occurredAt;
			const review = createReviewEvent({ occurredAt, text });
			if (review) {
				group.events.push(review);
			}
		}
		for (const shelfName of parseShelfNames(row["shelves"] ?? "")) {
			const lifecycle = getShelfLifecycle(shelfName);
			if (lifecycle === "complete") {
				if (!hasExplicitCompletion) {
					group.events.push(createCompleteEvent({ occurredAt: importedAt }));
				}
				hasExplicitCompletion = true;
			} else if (lifecycle === "progress") {
				group.events.push(createProgressEvent(importedAt));
			} else if (lifecycle === "backlog") {
				group.events.push(createBacklogEvent(importedAt));
			} else if (lifecycle === "dropped") {
				group.events.push(createDroppedEvent({ occurredAt: importedAt }));
			} else if (lifecycle === "on_hold") {
				group.events.push(createOnHoldEvent({ occurredAt: importedAt }));
			} else {
				addCollectionMembership(group, shelfName);
			}
		}
		const review = createReviewEvent({
			text: row["review"] ?? "",
			occurredAt: lastOccurredAt ?? importedAt,
			rating: normalizeRating(row["rating"] ?? ""),
		});
		if (review) {
			group.events.push(review);
		}
	}
	return {
		totalItems: rows.length,
		entityGroups: finalizeEntityGroups(groupMap.values()),
		failures,
	};
};
