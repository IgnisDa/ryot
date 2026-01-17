import { Effect, Either } from "@ryot/sandbox-sdk/effect";

import {
	extractMetadataLookupBaseTitle,
	extractMetadataLookupSeasonEpisode,
	hasMetadataLookupShowIndicators,
} from "../shared/title-parsing";
import { parseCsvText } from "./csv";
import { parseDateTime } from "./dates";
import { getOrCreateMediaEntityGroup, type ImportMediaEntityGroupBuilder } from "./groups";
import {
	createBacklogEvent,
	createCompleteEvent,
	createReviewEvent,
	finalizeEntityGroups,
} from "./helpers";
import type { ImportEntityRef, MediaImportAdapterFailure } from "./schemas";

type ResolvedRef = Extract<ImportEntityRef, { kind: "resolved" }>;
type NetflixLookupTitle = (input: {
	title: string;
	preferredEntitySchemaSlug?: "movie" | "show" | undefined;
}) => Effect.Effect<{ entityRef: ResolvedRef; matchedTitle: string }, string>;

const DATE_FORMATS = ["YYYY-MM-DD HH:mm:ss"];
const skipTitle = (title: string) =>
	title.includes("_hook_") ||
	title.includes("Clip:") ||
	title.includes("_CLIP_") ||
	title.includes("Trailer:") ||
	title.includes("_backfill");

const skipViewing = (row: Record<string, string>) =>
	Boolean(row["Supplemental Video Type"]?.trim()) ||
	row["Latest Bookmark"]?.trim() === "Not latest view" ||
	(row["Attributes"]?.includes("Autoplayed: user action: None;") ?? false) ||
	skipTitle(row["Title"]?.trim() ?? "");

const matchesProfile = (profile: string | undefined, filter: string | undefined) => {
	const trimmed = filter?.trim();
	return trimmed ? (profile?.trim() ?? "") === trimmed : true;
};

const requiredCell = (row: Record<string, string>, key: string) => {
	const value = row[key]?.trim();
	if (!value) {
		throw new Error(`Row is missing ${key}`);
	}
	return value;
};

const assertHeaders = (headers: string[], required: string[], label: string) => {
	if (headers.length === 0) {
		throw new Error(`${label} CSV is empty or has no header row`);
	}
	const missing = required.filter((header) => !headers.includes(header));
	if (missing.length > 0) {
		throw new Error(`${label} CSV is missing required columns: ${missing.join(", ")}`);
	}
};

const occurredAt = (value: string) => parseDateTime(value, DATE_FORMATS);

const convertedRating = (row: Record<string, string>) => {
	const stars = Number.parseInt(row["Star Value"]?.trim() ?? "", 10);
	if (Number.isFinite(stars)) {
		return stars >= 1 && stars <= 5 ? stars * 20 : null;
	}
	const thumbs = Number.parseInt(row["Thumbs Value"]?.trim() ?? "", 10);
	if (thumbs === 1) {
		return 33;
	}
	if (thumbs === 2) {
		return 67;
	}
	if (thumbs === 3) {
		return 100;
	}
	return null;
};

const lookupFailure = (input: {
	message: string;
	itemIndex: number;
	sourceLabel: string;
	sourceIdentifier?: string;
}): MediaImportAdapterFailure => ({
	stage: "provider_resolution",
	message: input.message,
	itemIndex: input.itemIndex,
	sourceLabel: input.sourceLabel,
	...(input.sourceIdentifier ? { sourceIdentifier: input.sourceIdentifier } : {}),
});

export const adaptNetflixExports = Effect.fn("netflixAdapter.adaptExports")(function* (
	input: {
		myListCsv: string;
		ratingsCsv: string;
		importedAt: string;
		profileName?: string | undefined;
		viewingActivityCsv: string;
	},
	lookupTitle: NetflixLookupTitle,
) {
	const viewing = parseCsvText(input.viewingActivityCsv);
	const ratings = parseCsvText(input.ratingsCsv);
	const myList = parseCsvText(input.myListCsv);
	assertHeaders(
		viewing.headers,
		["Title", "Start Time", "Profile Name"],
		"Netflix ViewingActivity",
	);
	assertHeaders(ratings.headers, ["Title Name", "Profile Name"], "Netflix Ratings");
	assertHeaders(myList.headers, ["Title Name", "Profile Name"], "Netflix MyList");

	const failures: MediaImportAdapterFailure[] = [];
	const groups = new Map<string, ImportMediaEntityGroupBuilder>();
	const titleContext = new Map<string, "movie" | "show">();
	for (const row of viewing.rows) {
		if (skipViewing(row) || !matchesProfile(row["Profile Name"], input.profileName)) {
			continue;
		}
		const title = row["Title"]?.trim() ?? "";
		const base = extractMetadataLookupBaseTitle(title);
		if (base) {
			titleContext.set(base, hasMetadataLookupShowIndicators(title) ? "show" : "movie");
		}
	}

	let itemIndex = 0;
	for (const row of viewing.rows) {
		const index = itemIndex++;
		if (skipViewing(row) || !matchesProfile(row["Profile Name"], input.profileName)) {
			continue;
		}
		const title = row["Title"]?.trim() ?? "";
		const label = title || `Netflix ViewingActivity row ${index + 1}`;
		const parsed = Either.try(() => {
			requiredCell(row, "Title");
			const date = occurredAt(requiredCell(row, "Start Time"));
			if (!date) {
				throw new Error("Start Time is invalid");
			}
			return { date, episode: extractMetadataLookupSeasonEpisode(title) };
		});
		if (Either.isLeft(parsed)) {
			failures.push({
				itemIndex: index,
				sourceLabel: label,
				sourceIdentifier: title || undefined,
				message: `ViewingActivity file: ${parsed.left instanceof Error ? parsed.left.message : "Netflix row is malformed"}`,
			});
			continue;
		}
		const lookup = yield* Effect.either(
			lookupTitle({
				title,
				preferredEntitySchemaSlug: hasMetadataLookupShowIndicators(title) ? "show" : undefined,
			}),
		);
		if (Either.isLeft(lookup)) {
			failures.push(
				lookupFailure({
					message: lookup.left,
					itemIndex: index,
					sourceLabel: label,
					sourceIdentifier: title,
				}),
			);
			continue;
		}
		if (lookup.right.entityRef.entitySchemaSlug === "show") {
			if (!parsed.right.episode) {
				failures.push(
					lookupFailure({
						message: "Viewing activity matched a show but no season or episode could be extracted",
						itemIndex: index,
						sourceLabel: label,
						sourceIdentifier: title,
					}),
				);
				continue;
			}
			const group = getOrCreateMediaEntityGroup(groups, lookup.right.entityRef, index);
			group.events.push({
				properties: { progressPercent: 100 },
				eventSchemaSlug: "progress",
				occurredAt: parsed.right.date,
				unresolvedEpisode: {
					type: "show",
					seasonNumber: parsed.right.episode.season,
					episodeNumber: parsed.right.episode.episode,
				},
			});
		} else {
			const group = getOrCreateMediaEntityGroup(groups, lookup.right.entityRef, index);
			group.events.push(
				createCompleteEvent({ occurredAt: parsed.right.date, completedOn: parsed.right.date }),
			);
		}
	}

	for (const row of ratings.rows) {
		const index = itemIndex++;
		if (!matchesProfile(row["Profile Name"], input.profileName)) {
			continue;
		}
		const title = row["Title Name"]?.trim() ?? "";
		if (skipTitle(title)) {
			continue;
		}
		const label = title || `Netflix Ratings row ${index + 1}`;
		const parsed = Either.try(() => {
			requiredCell(row, "Title Name");
			return convertedRating(row);
		});
		if (Either.isLeft(parsed)) {
			failures.push({
				itemIndex: index,
				sourceLabel: label,
				sourceIdentifier: title || undefined,
				message: `Ratings file: ${parsed.left instanceof Error ? parsed.left.message : "Netflix row is malformed"}`,
			});
			continue;
		}
		if (parsed.right === null) {
			continue;
		}
		const lookup = yield* Effect.either(
			lookupTitle({
				title,
				preferredEntitySchemaSlug: titleContext.get(extractMetadataLookupBaseTitle(title)),
			}),
		);
		if (Either.isLeft(lookup)) {
			failures.push(
				lookupFailure({
					message: lookup.left,
					itemIndex: index,
					sourceLabel: label,
					sourceIdentifier: title,
				}),
			);
			continue;
		}
		const review = createReviewEvent({
			rating: parsed.right,
			occurredAt: occurredAt(row["Event Utc Ts"]?.trim() ?? "") ?? input.importedAt,
		});
		if (review) {
			getOrCreateMediaEntityGroup(groups, lookup.right.entityRef, index).events.push(review);
		}
	}

	for (const row of myList.rows) {
		const index = itemIndex++;
		if (!matchesProfile(row["Profile Name"], input.profileName)) {
			continue;
		}
		const title = row["Title Name"]?.trim() ?? "";
		if (skipTitle(title)) {
			continue;
		}
		const label = title || `Netflix MyList row ${index + 1}`;
		const parsed = Either.try(() => requiredCell(row, "Title Name"));
		if (Either.isLeft(parsed)) {
			failures.push({
				itemIndex: index,
				sourceLabel: label,
				sourceIdentifier: title || undefined,
				message: `MyList file: ${parsed.left instanceof Error ? parsed.left.message : "Netflix row is malformed"}`,
			});
			continue;
		}
		const lookup = yield* Effect.either(
			lookupTitle({
				title,
				preferredEntitySchemaSlug: titleContext.get(extractMetadataLookupBaseTitle(title)),
			}),
		);
		if (Either.isLeft(lookup)) {
			failures.push(
				lookupFailure({
					message: lookup.left,
					itemIndex: index,
					sourceLabel: label,
					sourceIdentifier: title,
				}),
			);
			continue;
		}
		getOrCreateMediaEntityGroup(groups, lookup.right.entityRef, index).events.push(
			createBacklogEvent(input.importedAt),
		);
	}

	return {
		failures,
		totalItems: itemIndex,
		entityGroups: finalizeEntityGroups(groups.values()),
	};
});
