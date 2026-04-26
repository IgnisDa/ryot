import { Option, Schema } from "effect";

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
} from "../../media/book/shared";
import { nowIso, parseDateTime, parseDateWithFormat } from "../../media/dates";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/import-processor";
import { parseCsvText } from "../../runtime/csv";

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

const parseGrouveeDate = (value: string | null | undefined): string | null => {
	const raw = value?.trim();
	if (!raw || raw === "None") {
		return null;
	}
	return (
		parseDateTime(raw, ["YYYY-MM-DDTHH:mm:ss[Z]", "YYYY-MM-DDTHH:mm:ssZ"]) ??
		parseDateWithFormat(raw, "YYYY-MM-DD")
	);
};

const parseShelfNames = (value: string): string[] => {
	const trimmed = value.trim();
	if (!trimmed) {
		return [];
	}
	try {
		return Option.match(decodeShelfRecord(JSON.parse(trimmed)), {
			onNone: () => [],
			onSome: (record) => Object.keys(record),
		});
	} catch {
		return [];
	}
};

const parseDateEntries = (value: string): ReadonlyArray<GrouveeDateEntry> => {
	const trimmed = value.trim();
	if (!trimmed) {
		return [];
	}
	try {
		return Option.getOrElse(decodeDateEntries(JSON.parse(trimmed)), () => []);
	} catch {
		return [];
	}
};

const parseStatusEntries = (value: string): ReadonlyArray<GrouveeStatusEntry> => {
	const trimmed = value.trim();
	if (!trimmed) {
		return [];
	}
	try {
		return Option.getOrElse(decodeStatusEntries(JSON.parse(trimmed)), () => []);
	} catch {
		return [];
	}
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

export const adaptGrouveeCsv = (csvText: string): MediaImportAdapterResult => {
	const { headers, rows } = parseCsvText(csvText);
	assertRequiredHeaders(
		headers,
		["id", "name", "dates", "shelves", "statuses", "giantbomb_id"],
		"Grouvee",
	);

	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ReturnType<typeof getOrCreateMediaEntityGroup>>();

	for (let itemIndex = 0; itemIndex < rows.length; itemIndex++) {
		const row = rows[itemIndex];
		if (!row) {
			continue;
		}

		const sourceName = row.name?.trim();
		const giantbombId = row.giantbomb_id?.trim() ?? "";
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
				scriptSlug: "video-game.giant-bomb",
			},
			itemIndex,
		);
		const importedAt = nowIso();
		const shelfNames = parseShelfNames(row.shelves ?? "");
		const dateEntries = parseDateEntries(row.dates ?? "");
		const statusEntries = parseStatusEntries(row.statuses ?? "");

		let hasExplicitCompletion = false;
		let lastOccurredAt: string | undefined;

		for (const entry of dateEntries) {
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

		for (const statusEntry of statusEntries) {
			const text = statusEntry.status?.trim();
			if (!text) {
				continue;
			}
			const occurredAt = parseGrouveeDate(statusEntry.date) ?? importedAt;
			lastOccurredAt = occurredAt;
			const reviewEvent = createReviewEvent({ occurredAt, text });
			if (reviewEvent) {
				group.events.push(reviewEvent);
			}
		}

		for (const shelfName of shelfNames) {
			const lifecycle = getShelfLifecycle(shelfName);
			if (lifecycle === "complete") {
				if (!hasExplicitCompletion) {
					group.events.push(createCompleteEvent({ occurredAt: importedAt }));
					hasExplicitCompletion = true;
				}
				continue;
			}
			if (lifecycle === "progress") {
				group.events.push(createProgressEvent(importedAt));
				continue;
			}
			if (lifecycle === "backlog") {
				group.events.push(createBacklogEvent(importedAt));
				continue;
			}
			if (lifecycle === "dropped") {
				group.events.push(createDroppedEvent({ occurredAt: importedAt }));
				continue;
			}
			if (lifecycle === "on_hold") {
				group.events.push(createOnHoldEvent({ occurredAt: importedAt }));
				continue;
			}
			addCollectionMembership(group, shelfName);
		}

		const reviewEvent = createReviewEvent({
			text: row.review ?? "",
			occurredAt: lastOccurredAt ?? importedAt,
			rating: normalizeRating(row.rating ?? ""),
		});
		if (reviewEvent) {
			group.events.push(reviewEvent);
		}
	}

	return { entityGroups: finalizeEntityGroups(groupMap), failures };
};
