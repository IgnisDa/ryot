import { dayjs } from "@ryot/ts-utils/dayjs";

import type { ResolvedImportEntityRef } from "../../jobs";
import {
	assertRequiredHeaders,
	createBacklogEvent,
	createCompleteEvent,
	createReviewEvent,
	finalizeEntityGroups,
	parseDateTime,
} from "../../media/book/shared";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/import-processor";
import { parseCsvText, readRequiredCsvCell } from "../../runtime/csv";
import {
	extractNetflixBaseTitle,
	extractNetflixSeasonEpisode,
	hasNetflixShowIndicators,
} from "./title-matching";

const NETFLIX_DATETIME_FORMATS = ["YYYY-MM-DD HH:mm:ss"];

type NetflixLookupResult = { entityRef: ResolvedImportEntityRef } | { error: string };

type NetflixLookupTitle = (input: {
	title: string;
	preferredEntitySchemaSlug?: "movie" | "show";
}) => Promise<{ entityRef: ResolvedImportEntityRef; matchedTitle: string } | { error: string }>;

type NetflixImportAdapterDeps = {
	now: () => string;
	lookupTitle: NetflixLookupTitle;
};

const netflixImportAdapterDeps: NetflixImportAdapterDeps = {
	now: () => dayjs().toISOString(),
	lookupTitle: () => Promise.resolve({ error: "Netflix title lookup is not configured" }),
};

const shouldSkipTitle = (title: string): boolean =>
	title.includes("_hook_") ||
	title.includes("Clip:") ||
	title.includes("_CLIP_") ||
	title.includes("Trailer:") ||
	title.includes("_backfill");

const shouldSkipViewingEntry = (row: Record<string, string>): boolean => {
	const supplementalVideoType = row["Supplemental Video Type"]?.trim() ?? "";
	if (supplementalVideoType) {
		return true;
	}
	if ((row["Latest Bookmark"]?.trim() ?? "") === "Not latest view") {
		return true;
	}
	if ((row.Attributes?.trim() ?? "").includes("Autoplayed: user action: None;")) {
		return true;
	}
	return shouldSkipTitle(row.Title?.trim() ?? "");
};

const matchesProfileFilter = (
	profileName: string | undefined,
	filter: string | undefined,
): boolean => {
	const trimmedFilter = filter?.trim();
	return trimmedFilter ? (profileName?.trim() ?? "") === trimmedFilter : true;
};

const convertNetflixRating = (input: {
	thumbsValue?: string;
	starValue?: string;
}): number | null => {
	const starValue = Number.parseInt(input.starValue?.trim() ?? "", 10);
	if (Number.isFinite(starValue)) {
		return starValue >= 1 && starValue <= 5 ? starValue * 20 : null;
	}

	const thumbsValue = Number.parseInt(input.thumbsValue?.trim() ?? "", 10);
	if (!Number.isFinite(thumbsValue) || thumbsValue === 0) {
		return null;
	}
	if (thumbsValue === 1) {
		return 33;
	}
	if (thumbsValue === 2) {
		return 67;
	}
	if (thumbsValue === 3) {
		return 100;
	}
	return null;
};

const parseNetflixOccurredAt = (value: string): string | null =>
	parseDateTime(value, NETFLIX_DATETIME_FORMATS);

const lookupNetflixTitle = async (input: {
	lookupTitle: NetflixLookupTitle;
	title: string;
	preferredEntitySchemaSlug?: "movie" | "show";
}): Promise<NetflixLookupResult> => {
	try {
		const lookup = await input.lookupTitle({
			title: input.title,
			preferredEntitySchemaSlug: input.preferredEntitySchemaSlug,
		});
		return "entityRef" in lookup ? { entityRef: lookup.entityRef } : { error: lookup.error };
	} catch (error) {
		return {
			error: error instanceof Error ? error.message : "Netflix title lookup failed",
		};
	}
};

const createLookupFailure = (input: {
	message: string;
	itemIndex: number;
	sourceLabel: string;
	sourceIdentifier?: string;
}): MediaImportAdapterFailure => ({
	message: input.message,
	itemIndex: input.itemIndex,
	stage: "provider_resolution",
	sourceLabel: input.sourceLabel,
	...(input.sourceIdentifier ? { sourceIdentifier: input.sourceIdentifier } : {}),
});

export const adaptNetflixExports = async (
	input: {
		myListCsv: string;
		ratingsCsv: string;
		profileName?: string;
		viewingActivityCsv: string;
	},
	deps: NetflixImportAdapterDeps = netflixImportAdapterDeps,
): Promise<MediaImportAdapterResult> => {
	const myListData = parseCsvText(input.myListCsv);
	const ratingsData = parseCsvText(input.ratingsCsv);
	const viewingData = parseCsvText(input.viewingActivityCsv);
	assertRequiredHeaders(
		viewingData.headers,
		["Title", "Start Time", "Profile Name"],
		"Netflix ViewingActivity",
	);
	assertRequiredHeaders(ratingsData.headers, ["Title Name", "Profile Name"], "Netflix Ratings");
	assertRequiredHeaders(myListData.headers, ["Title Name", "Profile Name"], "Netflix MyList");

	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ReturnType<typeof getOrCreateMediaEntityGroup>>();
	const importedAt = deps.now();
	const titleContext = new Map<string, "movie" | "show">();

	for (const row of viewingData.rows) {
		if (shouldSkipViewingEntry(row)) {
			continue;
		}
		if (!matchesProfileFilter(row["Profile Name"], input.profileName)) {
			continue;
		}
		const title = row.Title?.trim();
		if (!title) {
			continue;
		}
		const baseTitle = extractNetflixBaseTitle(title);
		if (!baseTitle) {
			continue;
		}
		titleContext.set(baseTitle, hasNetflixShowIndicators(title) ? "show" : "movie");
	}

	let itemIndex = 0;
	// Row processing stays sequential so failure indices and merged event ordering remain stable.
	// oxlint-disable no-await-in-loop
	for (const row of viewingData.rows) {
		const currentItemIndex = itemIndex;
		itemIndex += 1;
		if (
			shouldSkipViewingEntry(row) ||
			!matchesProfileFilter(row["Profile Name"], input.profileName)
		) {
			continue;
		}

		const title = row.Title?.trim() ?? "";
		const sourceLabel = title || `Netflix ViewingActivity row ${currentItemIndex + 1}`;
		try {
			readRequiredCsvCell(row, ["Title"], "Title");
			const occurredAtValue = readRequiredCsvCell(row, ["Start Time"], "Start Time");
			const occurredAt = parseNetflixOccurredAt(occurredAtValue);
			if (!occurredAt) {
				throw new Error("Start Time is invalid");
			}

			const episodeInfo = extractNetflixSeasonEpisode(title);
			const lookup = await lookupNetflixTitle({
				title,
				lookupTitle: deps.lookupTitle,
				preferredEntitySchemaSlug: hasNetflixShowIndicators(title) ? "show" : undefined,
			});
			if ("error" in lookup) {
				failures.push(
					createLookupFailure({
						sourceLabel,
						message: lookup.error,
						sourceIdentifier: title,
						itemIndex: currentItemIndex,
					}),
				);
				continue;
			}

			if (lookup.entityRef.entitySchemaSlug === "show") {
				if (!episodeInfo) {
					failures.push(
						createLookupFailure({
							sourceLabel,
							sourceIdentifier: title,
							itemIndex: currentItemIndex,
							message:
								"Viewing activity matched a show but no season or episode could be extracted",
						}),
					);
					continue;
				}
				const group = getOrCreateMediaEntityGroup(groupMap, lookup.entityRef, currentItemIndex);
				group.events.push({
					occurredAt,
					eventSchemaSlug: "progress",
					properties: {
						progressPercent: 100,
						showSeason: episodeInfo.season,
						showEpisode: episodeInfo.episode,
					},
				});
				continue;
			}

			const group = getOrCreateMediaEntityGroup(groupMap, lookup.entityRef, currentItemIndex);
			group.events.push(createCompleteEvent({ occurredAt, completedOn: occurredAt }));
		} catch (error) {
			failures.push({
				sourceLabel,
				itemIndex: currentItemIndex,
				sourceIdentifier: title || undefined,
				message: `ViewingActivity file: ${error instanceof Error ? error.message : "Netflix row is malformed"}`,
			});
		}
	}

	for (const row of ratingsData.rows) {
		const currentItemIndex = itemIndex;
		itemIndex += 1;
		if (!matchesProfileFilter(row["Profile Name"], input.profileName)) {
			continue;
		}

		const title = row["Title Name"]?.trim() ?? "";
		if (shouldSkipTitle(title)) {
			continue;
		}
		const sourceLabel = title || `Netflix Ratings row ${currentItemIndex + 1}`;
		try {
			readRequiredCsvCell(row, ["Title Name"], "Title Name");
			const rating = convertNetflixRating({
				starValue: row["Star Value"],
				thumbsValue: row["Thumbs Value"],
			});
			if (rating === null) {
				continue;
			}

			const lookup = await lookupNetflixTitle({
				title,
				lookupTitle: deps.lookupTitle,
				preferredEntitySchemaSlug: titleContext.get(extractNetflixBaseTitle(title)),
			});
			if ("error" in lookup) {
				failures.push(
					createLookupFailure({
						sourceLabel,
						message: lookup.error,
						sourceIdentifier: title,
						itemIndex: currentItemIndex,
					}),
				);
				continue;
			}

			const occurredAt = parseNetflixOccurredAt(row["Event Utc Ts"]?.trim() ?? "") ?? importedAt;
			const reviewEvent = createReviewEvent({ occurredAt, rating });
			if (!reviewEvent) {
				continue;
			}

			const group = getOrCreateMediaEntityGroup(groupMap, lookup.entityRef, currentItemIndex);
			group.events.push(reviewEvent);
		} catch (error) {
			failures.push({
				sourceLabel,
				itemIndex: currentItemIndex,
				sourceIdentifier: title || undefined,
				message: `Ratings file: ${error instanceof Error ? error.message : "Netflix row is malformed"}`,
			});
		}
	}

	for (const row of myListData.rows) {
		const currentItemIndex = itemIndex;
		itemIndex += 1;
		if (!matchesProfileFilter(row["Profile Name"], input.profileName)) {
			continue;
		}

		const title = row["Title Name"]?.trim() ?? "";
		if (shouldSkipTitle(title)) {
			continue;
		}
		const sourceLabel = title || `Netflix MyList row ${currentItemIndex + 1}`;
		try {
			readRequiredCsvCell(row, ["Title Name"], "Title Name");
			const lookup = await lookupNetflixTitle({
				title,
				lookupTitle: deps.lookupTitle,
				preferredEntitySchemaSlug: titleContext.get(extractNetflixBaseTitle(title)),
			});
			if ("error" in lookup) {
				failures.push(
					createLookupFailure({
						sourceLabel,
						message: lookup.error,
						sourceIdentifier: title,
						itemIndex: currentItemIndex,
					}),
				);
				continue;
			}

			const group = getOrCreateMediaEntityGroup(groupMap, lookup.entityRef, currentItemIndex);
			group.events.push(createBacklogEvent(importedAt));
		} catch (error) {
			failures.push({
				sourceLabel,
				itemIndex: currentItemIndex,
				sourceIdentifier: title || undefined,
				message: `MyList file: ${error instanceof Error ? error.message : "Netflix row is malformed"}`,
			});
		}
	}
	// oxlint-enable no-await-in-loop

	return { entityGroups: finalizeEntityGroups(groupMap), failures };
};
