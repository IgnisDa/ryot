import { dayjs } from "@ryot/ts-utils/dayjs";
import { z } from "zod";

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
	parseDateTime,
	parseDateWithFormat,
} from "../../media/book/shared";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/import-processor";
import { parseCsvText } from "../../runtime/csv";

type GrouveeDateEntry = {
	date_started?: string | null;
	date_finished?: string | null;
	seconds_played?: number | null;
};

type GrouveeStatusEntry = {
	date?: string | null;
	status?: string | null;
};

const grouveeDateEntrySchema = z.object({
	date_started: z.string().nullable().optional(),
	date_finished: z.string().nullable().optional(),
	seconds_played: z.number().nullable().optional(),
});

const grouveeStatusEntrySchema = z.object({
	date: z.string().nullable().optional(),
	status: z.string().nullable().optional(),
});

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
		const parsed = z.record(z.string(), z.unknown()).safeParse(JSON.parse(trimmed) as unknown);
		return parsed.success ? Object.keys(parsed.data) : [];
	} catch {
		return [];
	}
};

const parseDateEntries = (value: string): GrouveeDateEntry[] => {
	const trimmed = value.trim();
	if (!trimmed) {
		return [];
	}
	try {
		const parsed = z.array(grouveeDateEntrySchema).safeParse(JSON.parse(trimmed) as unknown);
		return parsed.success ? parsed.data : [];
	} catch {
		return [];
	}
};

const parseStatusEntries = (value: string): GrouveeStatusEntry[] => {
	const trimmed = value.trim();
	if (!trimmed) {
		return [];
	}
	try {
		const parsed = z.array(grouveeStatusEntrySchema).safeParse(JSON.parse(trimmed) as unknown);
		return parsed.success ? parsed.data : [];
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
		const importedAt = dayjs().toISOString();
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
