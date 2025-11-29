import { dayjs } from "@ryot/ts-utils/dayjs";

import { parseCsvText } from "../../csv";
import { resolveBookEntityRefByIsbn } from "../book/provider-lookup";
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
	isValidIsbn,
	isLifecycleAlias,
	normalizeIsbn,
	normalizeLifecycleStatus,
	normalizeRating,
	normalizeReadCount,
	parseDateWithFormat,
	splitCommaList,
	type BookCsvAdapterFailure,
	type BookCsvAdapterResult,
	type ResolveBookEntityRef,
} from "../book/shared";

type StoryGraphAdapterDeps = {
	resolveBookEntityRef: ResolveBookEntityRef;
};

const storyGraphAdapterDeps: StoryGraphAdapterDeps = {
	resolveBookEntityRef: resolveBookEntityRefByIsbn,
};

const recordFailure = (failures: BookCsvAdapterFailure[], input: BookCsvAdapterFailure): void => {
	failures.push(input);
};

export const adaptStorygraphCsv = async (
	csvText: string,
	deps: StoryGraphAdapterDeps = storyGraphAdapterDeps,
): Promise<BookCsvAdapterResult> => {
	const { headers, rows } = parseCsvText(csvText);
	assertRequiredHeaders(headers, ["Title", "ISBN/UID", "Read Status"], "StoryGraph");

	const failures: BookCsvAdapterFailure[] = [];
	const groupMap = new Map<string, ReturnType<typeof getOrCreateGroup>>();

	// oxlint-disable no-await-in-loop
	for (let itemIndex = 0; itemIndex < rows.length; itemIndex++) {
		const row = rows[itemIndex];
		if (!row) {
			continue;
		}

		const title = row.Title?.trim();
		let sourceLabel = `StoryGraph row ${itemIndex + 1}`;
		if (title) {
			sourceLabel = title;
		}
		const isbn = normalizeIsbn(row["ISBN/UID"] ?? "");
		if (!isbn) {
			recordFailure(failures, { itemIndex, sourceLabel, message: "No ISBN found" });
			continue;
		}
		if (!isValidIsbn(isbn)) {
			recordFailure(failures, {
				itemIndex,
				sourceLabel,
				context: { isbn },
				sourceIdentifier: isbn,
				message: "ISBN/UID is not a valid ISBN",
			});
			continue;
		}

		let entityRef;
		try {
			entityRef = await deps.resolveBookEntityRef({ isbn, sourceLabel });
		} catch (error) {
			recordFailure(failures, {
				itemIndex,
				sourceLabel,
				context: { isbn },
				sourceIdentifier: isbn,
				message: error instanceof Error ? error.message : "Book provider lookup failed",
			});
			continue;
		}

		if (!entityRef) {
			recordFailure(failures, {
				itemIndex,
				sourceLabel,
				context: { isbn },
				sourceIdentifier: isbn,
				message: "Could not resolve ISBN to a supported book provider",
			});
			continue;
		}

		const group = getOrCreateGroup(groupMap, entityRef);
		const lifecycleStatus = normalizeLifecycleStatus(row["Read Status"] ?? "");
		const completedOn = parseDateWithFormat(row["Last Date Read"] ?? "", "YYYY/MM/DD");
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
			text: row.Review ?? "",
			occurredAt: completedOn ?? fallbackOccurredAt,
			rating: normalizeRating(row["Star Rating"] ?? ""),
		});
		if (reviewEvent) {
			group.events.push(reviewEvent);
		}

		for (const tag of splitCommaList(row.Tags ?? "")) {
			if (isLifecycleAlias(tag)) {
				continue;
			}
			addCollectionMembership(group, tag);
		}
	}
	// oxlint-enable no-await-in-loop

	return { entityGroups: finalizeEntityGroups(groupMap), failures };
};
