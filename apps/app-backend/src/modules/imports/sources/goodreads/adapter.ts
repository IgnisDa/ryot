import { dayjs } from "@ryot/ts-utils/dayjs";

import { resolveBookEntityRefByIsbn } from "../../media/book/provider-lookup";
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
	isValidIsbn,
	isLifecycleAlias,
	normalizeIsbn,
	normalizeLifecycleStatus,
	normalizeRating,
	normalizeReadCount,
	parseDateWithFormat,
	splitCommaList,
	toTitleCaseWords,
	type ResolveBookEntityRef,
} from "../../media/book/shared";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/import-processor";
import { parseCsvText } from "../../runtime/csv";

type GoodreadsAdapterDeps = {
	resolveBookEntityRef: ResolveBookEntityRef;
};

const goodreadsAdapterDeps: GoodreadsAdapterDeps = {
	resolveBookEntityRef: resolveBookEntityRefByIsbn,
};

const selectLifecycleStatus = (shelves: string[]): ReturnType<typeof normalizeLifecycleStatus> => {
	const statuses = new Set(shelves.map((shelf) => normalizeLifecycleStatus(shelf)).filter(Boolean));
	if (statuses.has("progress")) {
		return "progress";
	}
	if (statuses.has("backlog")) {
		return "backlog";
	}
	if (statuses.has("on_hold")) {
		return "on_hold";
	}
	if (statuses.has("dropped")) {
		return "dropped";
	}
	if (statuses.has("complete")) {
		return "complete";
	}
	return undefined;
};

export const adaptGoodreadsCsv = async (
	csvText: string,
	deps: GoodreadsAdapterDeps = goodreadsAdapterDeps,
): Promise<MediaImportAdapterResult> => {
	const { headers, rows } = parseCsvText(csvText);
	assertRequiredHeaders(headers, ["Title", "ISBN13", "Bookshelves"], "Goodreads");

	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ReturnType<typeof getOrCreateMediaEntityGroup>>();

	// oxlint-disable no-await-in-loop
	for (let itemIndex = 0; itemIndex < rows.length; itemIndex++) {
		const row = rows[itemIndex];
		if (!row) {
			continue;
		}

		const title = row.Title?.trim();
		let sourceLabel = `Goodreads row ${itemIndex + 1}`;
		if (title) {
			sourceLabel = title;
		}
		const isbn = normalizeIsbn(row.ISBN13 ?? "");
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

		let entityRef;
		try {
			entityRef = await deps.resolveBookEntityRef({ isbn, sourceLabel });
		} catch (error) {
			failures.push({
				itemIndex,
				sourceLabel,
				context: { isbn },
				sourceIdentifier: isbn,
				message: error instanceof Error ? error.message : "Book provider lookup failed",
			});
			continue;
		}

		if (!entityRef) {
			failures.push({
				itemIndex,
				sourceLabel,
				context: { isbn },
				sourceIdentifier: isbn,
				message: "Could not resolve ISBN to a supported book provider",
			});
			continue;
		}

		const group = getOrCreateMediaEntityGroup(groupMap, entityRef);
		const shelves = splitCommaList(row.Bookshelves ?? "");
		const lifecycleStatus = selectLifecycleStatus(shelves);
		const completedOn = parseDateWithFormat(row["Date Read"] ?? "", "YYYY/MM/DD");
		const fallbackOccurredAt = completedOn ?? dayjs().toISOString();
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

		const reviewEvent = createReviewEvent({
			text: row["My Review"] ?? "",
			occurredAt: completedOn ?? fallbackOccurredAt,
			rating: normalizeRating(row["My Rating"] ?? ""),
		});
		if (reviewEvent) {
			group.events.push(reviewEvent);
		}

		for (const shelf of shelves) {
			if (isLifecycleAlias(shelf)) {
				continue;
			}
			addCollectionMembership(group, toTitleCaseWords(shelf));
		}
	}
	// oxlint-enable no-await-in-loop

	return { entityGroups: finalizeEntityGroups(groupMap), failures };
};
