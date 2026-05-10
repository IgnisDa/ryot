import { Effect, Either } from "effect";

import {
	assertRequiredHeaders,
	createBacklogEvent,
	createCompleteEvent,
	createReviewEvent,
	finalizeEntityGroups,
} from "../../media/book/shared";
import { parseDateTime } from "../../media/dates";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type { MediaImportAdapterFailure } from "../../media/import-processor";
import type { ImportMediaEntityGroup, ResolvedImportEntityRef } from "../../media/types";
import { parseCsvText, readRequiredCsvCell } from "../../runtime/csv";
import {
	extractNetflixBaseTitle,
	extractNetflixSeasonEpisode,
	hasNetflixShowIndicators,
} from "./title-matching";

const NETFLIX_DATETIME_FORMATS = ["YYYY-MM-DD HH:mm:ss"];

type NetflixLookupTitle = (input: {
	title: string;
	preferredEntitySchemaSlug?: "movie" | "show";
}) => Effect.Effect<{ entityRef: ResolvedImportEntityRef; matchedTitle: string }, string>;

type NetflixRatingRowResult =
	| { skip: true }
	| { ok: false; failure: MediaImportAdapterFailure }
	| { ok: true; title: string; rating: number; occurredAt: string; sourceLabel: string };

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
	const parsed = Either.try(() => {
		readRequiredCsvCell(row, ["Title"], "Title");
		const occurredAtValue = readRequiredCsvCell(row, ["Start Time"], "Start Time");
		const occurredAt = parseNetflixOccurredAt(occurredAtValue);
		if (!occurredAt) {
			throw new Error("Start Time is invalid");
		}
		return {
			occurredAt,
			episodeInfo: extractNetflixSeasonEpisode(title),
		};
	});
	if (Either.isLeft(parsed)) {
		return {
			ok: false as const,
			failure: {
				itemIndex,
				sourceLabel,
				sourceIdentifier: title || undefined,
				message: `ViewingActivity file: ${getRowErrorMessage(parsed.left)}`,
			},
		};
	}
	return {
		title,
		sourceLabel,
		ok: true as const,
		occurredAt: parsed.right.occurredAt,
		episodeInfo: parsed.right.episodeInfo,
	};
};

const parseRatingRow = (
	row: Record<string, string>,
	itemIndex: number,
	importedAt: string,
): NetflixRatingRowResult => {
	const title = row["Title Name"]?.trim() ?? "";
	const sourceLabel = title || `Netflix Ratings row ${itemIndex + 1}`;
	const parsed = Either.try(() => {
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
	});
	if (Either.isLeft(parsed)) {
		return {
			ok: false as const,
			failure: {
				itemIndex,
				sourceLabel,
				sourceIdentifier: title || undefined,
				message: `Ratings file: ${getRowErrorMessage(parsed.left)}`,
			},
		};
	}
	if ("skip" in parsed.right) {
		return parsed.right;
	}
	return parsed.right;
};

const parseMyListRow = (row: Record<string, string>, itemIndex: number) => {
	const title = row["Title Name"]?.trim() ?? "";
	const sourceLabel = title || `Netflix MyList row ${itemIndex + 1}`;
	const parsed = Either.try(() => readRequiredCsvCell(row, ["Title Name"], "Title Name"));
	if (Either.isLeft(parsed)) {
		return {
			ok: false as const,
			failure: {
				itemIndex,
				sourceLabel,
				sourceIdentifier: title || undefined,
				message: `MyList file: ${getRowErrorMessage(parsed.left)}`,
			},
		};
	}
	return { title, sourceLabel, ok: true as const };
};

export const adaptNetflixExports = Effect.fn("netflixAdapter.adaptExports")(function* (
	input: {
		myListCsv: string;
		ratingsCsv: string;
		importedAt: string;
		profileName?: string;
		viewingActivityCsv: string;
	},
	lookupTitle: NetflixLookupTitle,
) {
	const { myListData, ratingsData, viewingData } = yield* Effect.try({
		catch: getParseErrorMessage,
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
	});

	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ImportMediaEntityGroup>();
	const importedAt = input.importedAt;
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

		const lookupResult = yield* Effect.either(
			lookupTitle({
				title: rowResult.title,
				preferredEntitySchemaSlug: hasNetflixShowIndicators(rowResult.title) ? "show" : undefined,
			}),
		);
		if (Either.isLeft(lookupResult)) {
			failures.push(
				createLookupFailure({
					message: lookupResult.left,
					itemIndex: currentItemIndex,
					sourceIdentifier: rowResult.title,
					sourceLabel: rowResult.sourceLabel,
				}),
			);
			continue;
		}

		const { entityRef } = lookupResult.right;
		if (entityRef.entitySchemaSlug === "show") {
			if (!rowResult.episodeInfo) {
				failures.push(
					createLookupFailure({
						itemIndex: currentItemIndex,
						sourceIdentifier: rowResult.title,
						sourceLabel: rowResult.sourceLabel,
						message: "Viewing activity matched a show but no season or episode could be extracted",
					}),
				);
				continue;
			}
			const group = getOrCreateMediaEntityGroup(groupMap, entityRef, currentItemIndex);
			group.events.push({
				eventSchemaSlug: "progress",
				occurredAt: rowResult.occurredAt,
				properties: {
					progressPercent: 100,
					showSeason: rowResult.episodeInfo.season,
					showEpisode: rowResult.episodeInfo.episode,
				},
			});
			continue;
		}

		const group = getOrCreateMediaEntityGroup(groupMap, entityRef, currentItemIndex);
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

		const lookupResult = yield* Effect.either(
			lookupTitle({
				title: rowResult.title,
				preferredEntitySchemaSlug: titleContext.get(extractNetflixBaseTitle(rowResult.title)),
			}),
		);
		if (Either.isLeft(lookupResult)) {
			failures.push(
				createLookupFailure({
					message: lookupResult.left,
					itemIndex: currentItemIndex,
					sourceIdentifier: rowResult.title,
					sourceLabel: rowResult.sourceLabel,
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

		const group = getOrCreateMediaEntityGroup(
			groupMap,
			lookupResult.right.entityRef,
			currentItemIndex,
		);
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

		const lookupResult = yield* Effect.either(
			lookupTitle({
				title: rowResult.title,
				preferredEntitySchemaSlug: titleContext.get(extractNetflixBaseTitle(rowResult.title)),
			}),
		);
		if (Either.isLeft(lookupResult)) {
			failures.push(
				createLookupFailure({
					message: lookupResult.left,
					itemIndex: currentItemIndex,
					sourceIdentifier: rowResult.title,
					sourceLabel: rowResult.sourceLabel,
				}),
			);
			continue;
		}

		const group = getOrCreateMediaEntityGroup(
			groupMap,
			lookupResult.right.entityRef,
			currentItemIndex,
		);
		group.events.push(createBacklogEvent(importedAt));
	}

	return { entityGroups: finalizeEntityGroups(groupMap), failures };
});
