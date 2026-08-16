import { parseCsvText } from "./csv";
import { nowIso, parseDateWithFormat } from "./dates";
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
	isLifecycleAlias,
	isValidIsbn,
	normalizeIsbn,
	normalizeLifecycleStatus,
	normalizeRating,
	normalizeReadCount,
	splitCommaList,
} from "./helpers";
import type { MediaImportAdapterFailure } from "./schemas";

export const adaptStorygraphCsv = (csvText: string) => {
	const { headers, rows } = parseCsvText(csvText);
	assertRequiredHeaders(headers, ["Title", "ISBN/UID", "Read Status"], "StoryGraph");
	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ImportMediaEntityGroupBuilder>();
	for (let itemIndex = 0; itemIndex < rows.length; itemIndex++) {
		const row = rows[itemIndex];
		if (!row) {
			continue;
		}
		const title = row["Title"]?.trim();
		const sourceLabel = title?.length ? title : `StoryGraph row ${itemIndex + 1}`;
		const isbn = normalizeIsbn(row["ISBN/UID"] ?? "");
		if (!isbn) {
			failures.push({ itemIndex, sourceLabel, message: "No ISBN found" });
			continue;
		}
		if (!isValidIsbn(isbn)) {
			failures.push({
				itemIndex,
				sourceLabel,
				context: { isbn },
				sourceIdentifier: isbn,
				message: "ISBN/UID is not a valid ISBN",
			});
			continue;
		}
		const group = getOrCreateMediaEntityGroup(
			groupMap,
			{
				sourceLabel,
				kind: "unresolved",
				identifierValue: isbn,
				identifierType: "isbn",
				entitySchemaSlug: "book",
			},
			itemIndex,
		);
		const lifecycleStatus = normalizeLifecycleStatus(row["Read Status"] ?? "");
		const completedOn = parseDateWithFormat(row["Last Date Read"] ?? "", "YYYY/MM/DD");
		const occurredAt = completedOn ?? nowIso();
		const readCount = normalizeReadCount(row["Read Count"] ?? "");
		for (let index = 0; index < readCount; index++) {
			group.events.push(createCompleteEvent({ completedOn, occurredAt }));
		}
		if (lifecycleStatus === "complete" && readCount === 0) {
			group.events.push(createCompleteEvent({ completedOn, occurredAt }));
		} else if (lifecycleStatus === "progress") {
			group.events.push(createProgressEvent(occurredAt));
		} else if (lifecycleStatus === "backlog") {
			group.events.push(createBacklogEvent(occurredAt));
		} else if (lifecycleStatus === "dropped") {
			group.events.push(createDroppedEvent({ occurredAt }));
		} else if (lifecycleStatus === "on_hold") {
			group.events.push(createOnHoldEvent({ occurredAt }));
		}
		const review = createReviewEvent({
			text: row["Review"] ?? "",
			occurredAt,
			rating: normalizeRating(row["Star Rating"] ?? ""),
		});
		if (review) {
			group.events.push(review);
		}
		for (const tag of splitCommaList(row["Tags"] ?? "")) {
			if (!isLifecycleAlias(tag)) {
				addCollectionMembership(group, tag);
			}
		}
	}
	return {
		totalItems: rows.length,
		entityGroups: finalizeEntityGroups(groupMap.values()),
		failures,
	};
};
