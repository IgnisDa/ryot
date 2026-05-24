import { Effect } from "effect";

import {
	assertRequiredHeaders,
	createBacklogEvent,
	createCompleteEvent,
	createReviewEvent,
	finalizeEntityGroups,
} from "../../media/book/shared";
import { nowIso, parseDateTime } from "../../media/dates";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/import-processor";
import type { ResolvedImportEntityRef } from "../../media/types";
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
}) => Effect.Effect<
	{ entityRef: ResolvedImportEntityRef; matchedTitle: string } | { error: string },
	unknown
>;

type NetflixImportAdapterDeps = {
	now: () => string;
	lookupTitle: NetflixLookupTitle;
};

const netflixImportAdapterDeps: NetflixImportAdapterDeps = {
	now: () => nowIso(),
	lookupTitle: () => Effect.succeed({ error: "Netflix title lookup is not configured" }),
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

const lookupNetflixTitle = (input: {
	lookupTitle: NetflixLookupTitle;
	title: string;
	preferredEntitySchemaSlug?: "movie" | "show";
}) =>
	input
		.lookupTitle({
			title: input.title,
			preferredEntitySchemaSlug: input.preferredEntitySchemaSlug,
		})
		.pipe(
			Effect.map(
				(lookup): NetflixLookupResult =>
					"entityRef" in lookup ? { entityRef: lookup.entityRef } : { error: lookup.error },
			),
			Effect.catchAll((error) =>
				Effect.succeed({
					error: error instanceof Error ? error.message : "Netflix title lookup failed",
				}),
			),
		);

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

const getParseErrorMessage = (error: unknown) =>
	error instanceof Error ? error.message : "Netflix export data is malformed";

const getRowErrorMessage = (error: unknown) =>
	error instanceof Error ? error.message : "Netflix row is malformed";

const parseViewingActivityRow = (row: Record<string, string>, itemIndex: number) => {
	const title = row.Title?.trim() ?? "";
	const sourceLabel = title || `Netflix ViewingActivity row ${itemIndex + 1}`;
	try {
		readRequiredCsvCell(row, ["Title"], "Title");
		const occurredAtValue = readRequiredCsvCell(row, ["Start Time"], "Start Time");
		const occurredAt = parseNetflixOccurredAt(occurredAtValue);
		if (!occurredAt) {
			throw new Error("Start Time is invalid");
		}
		return {
			title,
			occurredAt,
			sourceLabel,
			ok: true as const,
			episodeInfo: extractNetflixSeasonEpisode(title),
		};
	} catch (error) {
		return {
			ok: false as const,
			failure: {
				sourceLabel,
				itemIndex,
				sourceIdentifier: title || undefined,
				message: `ViewingActivity file: ${getRowErrorMessage(error)}`,
			},
		};
	}
};

const parseRatingRow = (row: Record<string, string>, itemIndex: number, importedAt: string) => {
	const title = row["Title Name"]?.trim() ?? "";
	const sourceLabel = title || `Netflix Ratings row ${itemIndex + 1}`;
	try {
		readRequiredCsvCell(row, ["Title Name"], "Title Name");
		const rating = convertNetflixRating({
			starValue: row["Star Value"],
			thumbsValue: row["Thumbs Value"],
		});
		if (rating === null) {
			return { skip: true as const };
		}
		return {
			title,
			rating,
			sourceLabel,
			ok: true as const,
			occurredAt: parseNetflixOccurredAt(row["Event Utc Ts"]?.trim() ?? "") ?? importedAt,
		};
	} catch (error) {
		return {
			ok: false as const,
			failure: {
				sourceLabel,
				itemIndex,
				sourceIdentifier: title || undefined,
				message: `Ratings file: ${getRowErrorMessage(error)}`,
			},
		};
	}
};

const parseMyListRow = (row: Record<string, string>, itemIndex: number) => {
	const title = row["Title Name"]?.trim() ?? "";
	const sourceLabel = title || `Netflix MyList row ${itemIndex + 1}`;
	try {
		readRequiredCsvCell(row, ["Title Name"], "Title Name");
		return { title, sourceLabel, ok: true as const };
	} catch (error) {
		return {
			ok: false as const,
			failure: {
				sourceLabel,
				itemIndex,
				sourceIdentifier: title || undefined,
				message: `MyList file: ${getRowErrorMessage(error)}`,
			},
		};
	}
};

export const adaptNetflixExports = (
	input: {
		myListCsv: string;
		ratingsCsv: string;
		profileName?: string;
		viewingActivityCsv: string;
	},
	deps: NetflixImportAdapterDeps = netflixImportAdapterDeps,
): Effect.Effect<MediaImportAdapterResult, string> =>
	Effect.gen(function* () {
		const { myListData, ratingsData, viewingData } = yield* Effect.try({
			try: () => {
				const parsedMyListData = parseCsvText(input.myListCsv);
				const parsedRatingsData = parseCsvText(input.ratingsCsv);
				const parsedViewingData = parseCsvText(input.viewingActivityCsv);
				assertRequiredHeaders(
					parsedViewingData.headers,
					["Title", "Start Time", "Profile Name"],
					"Netflix ViewingActivity",
				);
				assertRequiredHeaders(
					parsedRatingsData.headers,
					["Title Name", "Profile Name"],
					"Netflix Ratings",
				);
				assertRequiredHeaders(
					parsedMyListData.headers,
					["Title Name", "Profile Name"],
					"Netflix MyList",
				);
				return {
					myListData: parsedMyListData,
					ratingsData: parsedRatingsData,
					viewingData: parsedViewingData,
				};
			},
			catch: getParseErrorMessage,
		});

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
		for (const row of viewingData.rows) {
			const currentItemIndex = itemIndex;
			itemIndex += 1;
			if (
				shouldSkipViewingEntry(row) ||
				!matchesProfileFilter(row["Profile Name"], input.profileName)
			) {
				continue;
			}

			const rowResult = parseViewingActivityRow(row, currentItemIndex);
			if (!rowResult.ok) {
				failures.push(rowResult.failure);
				continue;
			}

			const lookup = yield* lookupNetflixTitle({
				title: rowResult.title,
				lookupTitle: deps.lookupTitle,
				preferredEntitySchemaSlug: hasNetflixShowIndicators(rowResult.title) ? "show" : undefined,
			});
			if ("error" in lookup) {
				failures.push(
					createLookupFailure({
						sourceLabel: rowResult.sourceLabel,
						message: lookup.error,
						sourceIdentifier: rowResult.title,
						itemIndex: currentItemIndex,
					}),
				);
				continue;
			}

			if (lookup.entityRef.entitySchemaSlug === "show") {
				if (!rowResult.episodeInfo) {
					failures.push(
						createLookupFailure({
							sourceLabel: rowResult.sourceLabel,
							sourceIdentifier: rowResult.title,
							itemIndex: currentItemIndex,
							message:
								"Viewing activity matched a show but no season or episode could be extracted",
						}),
					);
					continue;
				}
				const group = getOrCreateMediaEntityGroup(groupMap, lookup.entityRef, currentItemIndex);
				group.events.push({
					occurredAt: rowResult.occurredAt,
					eventSchemaSlug: "progress",
					properties: {
						progressPercent: 100,
						showSeason: rowResult.episodeInfo.season,
						showEpisode: rowResult.episodeInfo.episode,
					},
				});
				continue;
			}

			const group = getOrCreateMediaEntityGroup(groupMap, lookup.entityRef, currentItemIndex);
			group.events.push(
				createCompleteEvent({
					occurredAt: rowResult.occurredAt,
					completedOn: rowResult.occurredAt,
				}),
			);
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
			const rowResult = parseRatingRow(row, currentItemIndex, importedAt);
			if ("skip" in rowResult) {
				continue;
			}
			if (!rowResult.ok) {
				failures.push(rowResult.failure);
				continue;
			}

			const lookup = yield* lookupNetflixTitle({
				title: rowResult.title,
				lookupTitle: deps.lookupTitle,
				preferredEntitySchemaSlug: titleContext.get(extractNetflixBaseTitle(rowResult.title)),
			});
			if ("error" in lookup) {
				failures.push(
					createLookupFailure({
						sourceLabel: rowResult.sourceLabel,
						message: lookup.error,
						sourceIdentifier: rowResult.title,
						itemIndex: currentItemIndex,
					}),
				);
				continue;
			}

			const reviewEvent = createReviewEvent({
				rating: rowResult.rating,
				occurredAt: rowResult.occurredAt,
			});
			if (!reviewEvent) {
				continue;
			}

			const group = getOrCreateMediaEntityGroup(groupMap, lookup.entityRef, currentItemIndex);
			group.events.push(reviewEvent);
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
			const rowResult = parseMyListRow(row, currentItemIndex);
			if (!rowResult.ok) {
				failures.push(rowResult.failure);
				continue;
			}

			const lookup = yield* lookupNetflixTitle({
				title: rowResult.title,
				lookupTitle: deps.lookupTitle,
				preferredEntitySchemaSlug: titleContext.get(extractNetflixBaseTitle(rowResult.title)),
			});
			if ("error" in lookup) {
				failures.push(
					createLookupFailure({
						sourceLabel: rowResult.sourceLabel,
						message: lookup.error,
						sourceIdentifier: rowResult.title,
						itemIndex: currentItemIndex,
					}),
				);
				continue;
			}

			const group = getOrCreateMediaEntityGroup(groupMap, lookup.entityRef, currentItemIndex);
			group.events.push(createBacklogEvent(importedAt));
		}

		return { entityGroups: finalizeEntityGroups(groupMap), failures };
	});
