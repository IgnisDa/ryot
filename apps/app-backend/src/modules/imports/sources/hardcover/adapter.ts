import { dayjs } from "@ryot/ts-utils/dayjs";

import { parseCsvText } from "../../csv";
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
	getOrCreateGroup,
	isLifecycleAlias,
	normalizeBoolean,
	normalizeLifecycleStatus,
	normalizeRating,
	parseDateTime,
	parseDateWithFormat,
	splitCommaList,
	type BookCsvAdapterFailure,
	type BookCsvAdapterResult,
} from "../book/shared";

const sanitizeListName = (value: string): string => value.replace(/\s*\(#\d+\)\s*$/, "").trim();

export const adaptHardcoverCsv = (csvText: string): BookCsvAdapterResult => {
	const { headers, rows } = parseCsvText(csvText);
	assertRequiredHeaders(headers, ["Title", "Status", "Hardcover Book ID"], "Hardcover");

	const failures: BookCsvAdapterFailure[] = [];
	const groupMap = new Map<string, ReturnType<typeof getOrCreateGroup>>();

	for (let itemIndex = 0; itemIndex < rows.length; itemIndex++) {
		const row = rows[itemIndex];
		if (!row) {
			continue;
		}

		const title = row.Title?.trim();
		let sourceLabel = `Hardcover row ${itemIndex + 1}`;
		if (title) {
			sourceLabel = title;
		}
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

		const entityRef = {
			sourceLabel,
			externalId: hardcoverId,
			entitySchemaSlug: "book",
			scriptSlug: "book.hardcover",
		};
		const group = getOrCreateGroup(groupMap, entityRef);
		const startedOn = parseDateWithFormat(row["Date Started"] ?? "", "YYYY-MM-DD");
		const completedOn = parseDateWithFormat(row["Date Finished"] ?? "", "YYYY-MM-DD");
		const reviewOccurredAt =
			parseDateTime(row["Review Date"] ?? "", ["YYYY-MM-DDTHH:mm:ss[Z]", "YYYY-MM-DDTHH:mm:ssZ"]) ??
			completedOn ??
			startedOn ??
			dayjs().toISOString();
		const lifecycleStatus = normalizeLifecycleStatus(row.Status ?? "");
		const fallbackOccurredAt = completedOn ?? startedOn ?? reviewOccurredAt;

		if (lifecycleStatus === "complete" || completedOn) {
			group.events.push(
				createCompleteEvent({
					startedOn,
					completedOn,
					occurredAt: completedOn ?? fallbackOccurredAt,
				}),
			);
		} else if (lifecycleStatus === "progress") {
			group.events.push(createProgressEvent(startedOn ?? fallbackOccurredAt));
		} else if (lifecycleStatus === "backlog") {
			group.events.push(createBacklogEvent(fallbackOccurredAt));
		} else if (lifecycleStatus === "dropped") {
			group.events.push(createDroppedEvent({ occurredAt: fallbackOccurredAt, startedOn }));
		} else if (lifecycleStatus === "on_hold") {
			group.events.push(createOnHoldEvent({ occurredAt: fallbackOccurredAt, startedOn }));
		}

		const reviewEvent = createReviewEvent({
			text: row.Review ?? "",
			occurredAt: reviewOccurredAt,
			rating: normalizeRating(row.Rating ?? ""),
			isSpoiler: row["Review Contains Spoilers"]
				? normalizeBoolean(row["Review Contains Spoilers"])
				: undefined,
		});
		if (reviewEvent) {
			group.events.push(reviewEvent);
		}

		for (const rawList of splitCommaList(row.Lists ?? "")) {
			const listName = sanitizeListName(rawList);
			if (!listName || isLifecycleAlias(listName)) {
				continue;
			}
			addCollectionMembership(group, listName);
		}

		if (normalizeBoolean(row.Owned ?? "")) {
			addCollectionMembership(group, "Owned");
		}
	}

	return { entityGroups: finalizeEntityGroups(groupMap), failures };
};
