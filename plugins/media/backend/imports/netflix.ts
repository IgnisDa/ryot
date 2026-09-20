import { Result } from "@ryot-app/sandbox-sdk/effect";

import {
	extractMetadataLookupBaseTitle,
	extractMetadataLookupSeasonEpisode,
	hasMetadataLookupShowIndicators,
} from "../lib/title-parsing";
import { parseCsvText } from "./csv";
import { parseDateTime } from "./dates";
import { getOrCreateMediaEntityGroup, type ImportMediaEntityGroupBuilder } from "./groups";
import {
	createBacklogEvent,
	createCompleteEvent,
	createReviewEvent,
	finalizeEntityGroups,
} from "./helpers";
import type { MediaImportAdapterFailure } from "./schemas";

const skipTitle = (title: string) =>
	["_hook_", "Clip:", "_CLIP_", "Trailer:", "_backfill"].some((marker) => title.includes(marker));
const skipViewing = (row: Record<string, string>) =>
	Boolean(row["Supplemental Video Type"]?.trim()) ||
	row["Latest Bookmark"]?.trim() === "Not latest view" ||
	(row["Attributes"]?.includes("Autoplayed: user action: None;") ?? false) ||
	skipTitle(row["Title"]?.trim() ?? "");
const matchesProfile = (profile: string | undefined, filter: string | undefined) =>
	filter?.trim() ? (profile?.trim() ?? "") === filter.trim() : true;
const occurredAt = (value: string) => parseDateTime(value, ["YYYY-MM-DD HH:mm:ss"]);
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
export const netflixViewingContext = (input: {
	text: string;
	profileName?: string | undefined;
}) => {
	const row = parseCsvText(input.text).rows[0];
	if (!row || skipViewing(row) || !matchesProfile(row["Profile Name"], input.profileName)) {
		return null;
	}
	const title = extractMetadataLookupBaseTitle(row["Title"] ?? "");
	return title && new TextEncoder().encode(title).length <= 1024
		? {
				title,
				preferred: hasMetadataLookupShowIndicators(row["Title"] ?? "")
					? ("show" as const)
					: ("movie" as const),
			}
		: null;
};
export const adaptNetflixCsv = (input: {
	text: string;
	file: string;
	importedAt: string;
	profileName?: string | undefined;
}) => {
	const parsed = parseCsvText(input.text);
	const viewing = input.file === "ViewingActivity.csv";
	const required = viewing
		? ["Title", "Start Time", "Profile Name"]
		: ["Title Name", "Profile Name"];
	if (!parsed.headers.length) {
		throw new Error(`Netflix ${input.file} CSV is empty or has no header row`);
	}
	const missing = required.filter((header) => !parsed.headers.includes(header));
	if (missing.length) {
		throw new Error(`Netflix ${input.file} CSV is missing required columns: ${missing.join(", ")}`);
	}
	const groups = new Map<string, ImportMediaEntityGroupBuilder>();
	const failures: MediaImportAdapterFailure[] = [];
	for (const [itemIndex, row] of parsed.rows.entries()) {
		if (!matchesProfile(row["Profile Name"], input.profileName) || (viewing && skipViewing(row))) {
			continue;
		}
		const title = row[viewing ? "Title" : "Title Name"]?.trim() ?? "";
		if (skipTitle(title)) {
			continue;
		}
		const result = Result.try(() => {
			if (!title) {
				throw new Error("Row is missing title");
			}
			const baseTitle = extractMetadataLookupBaseTitle(title);
			if (!baseTitle) {
				throw new Error("Could not extract the media title");
			}
			if (new TextEncoder().encode(baseTitle).length > 1024) {
				throw new Error("Netflix title exceeds its bounded resolution descriptor");
			}
			const date = viewing ? occurredAt(row["Start Time"]?.trim() ?? "") : null;
			if (viewing && !date) {
				throw new Error("Start Time is invalid");
			}
			const rating = input.file === "Ratings.csv" ? convertedRating(row) : null;
			if (input.file === "Ratings.csv" && rating === null) {
				return;
			}
			const group = getOrCreateMediaEntityGroup(
				groups,
				{
					kind: "unresolved",
					sourceLabel: title,
					identifierValue: baseTitle,
					identifierType: "netflix-title",
					entitySchemaSlug: hasMetadataLookupShowIndicators(title) ? "show" : "movie-or-show",
				},
				itemIndex,
			);
			if (viewing && date) {
				const episode = extractMetadataLookupSeasonEpisode(title);
				group.events.push(
					episode
						? {
								occurredAt: date,
								eventSchemaSlug: "progress",
								properties: { progressPercent: 100 },
								unresolvedEpisode: {
									type: "show",
									seasonNumber: episode.season,
									episodeNumber: episode.episode,
								},
							}
						: createCompleteEvent({ occurredAt: date, completedOn: date }),
				);
			} else if (input.file === "Ratings.csv") {
				const event = createReviewEvent({
					rating,
					occurredAt: occurredAt(row["Event Utc Ts"]?.trim() ?? "") ?? input.importedAt,
				});
				if (event) {
					group.events.push(event);
				}
			} else {
				group.events.push(createBacklogEvent(input.importedAt));
			}
		});
		if (Result.isFailure(result)) {
			failures.push({
				itemIndex,
				sourceLabel: title,
				sourceIdentifier: title,
				message:
					result.failure instanceof Error ? result.failure.message : "Netflix row is malformed",
			});
		}
	}
	return {
		failures,
		totalItems: parsed.rows.length,
		entityGroups: finalizeEntityGroups(groups.values()),
	};
};
