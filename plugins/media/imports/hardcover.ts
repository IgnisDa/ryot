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
	isLifecycleAlias,
	normalizeBoolean,
	normalizeLifecycleStatus,
	normalizeRating,
	splitCommaList,
} from "./helpers";
import type { MediaImportAdapterFailure } from "./schemas";

const sanitizeListName = (value: string) => value.replace(/\s*\(#\d+\)\s*$/, "").trim();

export const adaptHardcoverCsv = (csvText: string) => {
	const { headers, rows } = parseCsvText(csvText);
	assertRequiredHeaders(headers, ["Title", "Status", "Hardcover Book ID"], "Hardcover");
	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ImportMediaEntityGroupBuilder>();
	for (let itemIndex = 0; itemIndex < rows.length; itemIndex++) {
		const row = rows[itemIndex];
		if (!row) {
			continue;
		}
		const title = row["Title"]?.trim();
		const sourceLabel = title?.length ? title : `Hardcover row ${itemIndex + 1}`;
		const hardcoverId = row["Hardcover Book ID"]?.trim() ?? "";
		if (!hardcoverId) {
			failures.push({ itemIndex, sourceLabel, message: "Empty Hardcover Book ID" });
			continue;
		}
		if (!/^\d+$/.test(hardcoverId)) {
			failures.push({
				itemIndex,
				sourceLabel,
				sourceIdentifier: hardcoverId,
				message: "Hardcover Book ID must be numeric",
			});
			continue;
		}
		const group = getOrCreateMediaEntityGroup(
			groupMap,
			{
				sourceLabel,
				externalId: hardcoverId,
				entitySchemaSlug: "book",
				kind: "resolved",
				providerSlug: "book.hardcover",
			},
			itemIndex,
		);
		const startedOn = parseDateWithFormat(row["Date Started"] ?? "", "YYYY-MM-DD");
		const completedOn = parseDateWithFormat(row["Date Finished"] ?? "", "YYYY-MM-DD");
		const reviewOccurredAt =
			parseDateTime(row["Review Date"] ?? "", ["YYYY-MM-DDTHH:mm:ss[Z]", "YYYY-MM-DDTHH:mm:ssZ"]) ??
			completedOn ??
			startedOn ??
			nowIso();
		const lifecycleStatus = normalizeLifecycleStatus(row["Status"] ?? "");
		const occurredAt = completedOn ?? startedOn ?? reviewOccurredAt;
		if (lifecycleStatus === "complete" || completedOn) {
			group.events.push(
				createCompleteEvent({ startedOn, completedOn, occurredAt: completedOn ?? occurredAt }),
			);
		} else if (lifecycleStatus === "progress") {
			group.events.push(createProgressEvent(startedOn ?? occurredAt));
		} else if (lifecycleStatus === "backlog") {
			group.events.push(createBacklogEvent(occurredAt));
		} else if (lifecycleStatus === "dropped") {
			group.events.push(createDroppedEvent({ occurredAt, startedOn }));
		} else if (lifecycleStatus === "on_hold") {
			group.events.push(createOnHoldEvent({ occurredAt, startedOn }));
		}
		const review = createReviewEvent({
			text: row["Review"] ?? "",
			occurredAt: reviewOccurredAt,
			rating: normalizeRating(row["Rating"] ?? ""),
			...(row["Review Contains Spoilers"]
				? { isSpoiler: normalizeBoolean(row["Review Contains Spoilers"]) }
				: {}),
		});
		if (review) {
			group.events.push(review);
		}
		for (const rawList of splitCommaList(row["Lists"] ?? "")) {
			const listName = sanitizeListName(rawList);
			if (listName && !isLifecycleAlias(listName)) {
				addCollectionMembership(group, listName);
			}
		}
		if (normalizeBoolean(row["Owned"] ?? "")) {
			addCollectionMembership(group, "Owned");
		}
	}
	return {
		totalItems: rows.length,
		entityGroups: finalizeEntityGroups(groupMap.values()),
		failures,
	};
};
