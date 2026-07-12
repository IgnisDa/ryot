import { DateTime, Option } from "@ryot/sandbox-sdk/effect";

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
	toTitleCaseWords,
} from "./helpers";
import type { MediaImportAdapterFailure } from "./schemas";

const selectLifecycleStatus = (shelves: string[]) => {
	const statuses = new Set(shelves.map(normalizeLifecycleStatus).filter(Boolean));
	for (const status of ["progress", "backlog", "on_hold", "dropped", "complete"] as const) {
		if (statuses.has(status)) {
			return status;
		}
	}
	return undefined;
};

export const adaptGoodreadsCsv = (csvText: string) => {
	const { headers, rows } = parseCsvText(csvText);
	assertRequiredHeaders(headers, ["Title", "ISBN13", "Bookshelves"], "Goodreads");
	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ImportMediaEntityGroupBuilder>();
	for (let itemIndex = 0; itemIndex < rows.length; itemIndex++) {
		const row = rows[itemIndex];
		if (!row) {
			continue;
		}
		const title = row["Title"]?.trim();
		const sourceLabel = title?.length ? title : `Goodreads row ${itemIndex + 1}`;
		const rawIsbn = (row["ISBN13"] ?? "").trim();
		const stripped = rawIsbn.replace(/^=/, "").replace(/^"|"$/g, "");
		if (stripped && !/^\d+$/.test(stripped)) {
			failures.push({
				itemIndex,
				sourceLabel,
				context: { rawIsbn },
				sourceIdentifier: stripped,
				message: "Invalid ISBN format",
			});
			continue;
		}
		const isbn = normalizeIsbn(rawIsbn);
		if (!isbn) {
			failures.push({ itemIndex, sourceLabel, message: "ISBN13 is empty" });
			continue;
		}
		if (!isValidIsbn(isbn)) {
			failures.push({
				itemIndex,
				sourceLabel,
				context: { isbn },
				sourceIdentifier: isbn,
				message: "ISBN13 is invalid",
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
		const shelves = splitCommaList(row["Bookshelves"] ?? "");
		const lifecycleStatus = selectLifecycleStatus(shelves);
		const dateRead = row["Date Read"]?.trim() ?? "";
		let completedOn: string | null = null;
		if (dateRead) {
			if (dateRead.split("/")[0]?.length === 4) {
				completedOn = parseDateWithFormat(dateRead, "YYYY/MM/DD");
			} else {
				const parts = dateRead.split("/");
				if (parts.length === 3) {
					const month = (parts[0] ?? "").padStart(2, "0");
					const day = (parts[1] ?? "").padStart(2, "0");
					let year = parts[2] ?? "";
					if (year.length === 2) {
						year = `20${year}`;
					}
					if (year.length === 4 && month && day) {
						completedOn = Option.match(DateTime.make(`${year}-${month}-${day}`), {
							onNone: () => null,
							onSome: DateTime.formatIso,
						});
					}
				}
			}
		}
		const fallbackOccurredAt = completedOn ?? nowIso();
		const readCount = normalizeReadCount(row["Read Count"] ?? "");
		for (let index = 0; index < readCount; index++) {
			group.events.push(
				createCompleteEvent({ completedOn, occurredAt: completedOn ?? fallbackOccurredAt }),
			);
		}
		if (lifecycleStatus === "complete" && readCount === 0) {
			group.events.push(
				createCompleteEvent({ completedOn, occurredAt: completedOn ?? fallbackOccurredAt }),
			);
		} else if (lifecycleStatus === "progress") {
			group.events.push(createProgressEvent(fallbackOccurredAt));
		} else if (lifecycleStatus === "backlog") {
			group.events.push(createBacklogEvent(fallbackOccurredAt));
		} else if (lifecycleStatus === "dropped") {
			group.events.push(createDroppedEvent({ occurredAt: fallbackOccurredAt }));
		} else if (lifecycleStatus === "on_hold") {
			group.events.push(createOnHoldEvent({ occurredAt: fallbackOccurredAt }));
		}
		const review = createReviewEvent({
			text: row["My Review"] ?? "",
			occurredAt: fallbackOccurredAt,
			rating: normalizeRating(row["My Rating"] ?? ""),
		});
		if (review) {
			group.events.push(review);
		}
		for (const shelf of shelves) {
			if (!isLifecycleAlias(shelf)) {
				addCollectionMembership(group, toTitleCaseWords(shelf));
			}
		}
	}
	return {
		totalItems: rows.length,
		entityGroups: finalizeEntityGroups(groupMap.values()),
		failures,
	};
};
