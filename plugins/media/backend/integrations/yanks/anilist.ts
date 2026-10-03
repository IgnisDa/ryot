import { DateTime, Option, Schema } from "@ryot-app/sandbox-sdk/effect";
import { IsoDateString } from "@ryot-app/sandbox-sdk/ryotql";

import { ListStatePropertiesSchema, type ListStateProperties } from "../../../shared/list-state";

const nonNegativeInteger = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const positiveInteger = Schema.Int.check(Schema.isGreaterThan(0));

export const AniListMediaType = Schema.Literals(["ANIME", "MANGA"]);
type AniListMediaType = typeof AniListMediaType.Type;

export const AniListCarry = Schema.Struct({
	chunk: positiveInteger,
	mediaType: AniListMediaType,
	observationAt: IsoDateString,
	sourceIndex: nonNegativeInteger,
	sourceAccountId: Schema.NonEmptyString,
	accountConnectionId: Schema.NonEmptyString,
	nextMediaType: Schema.NullOr(AniListMediaType),
});

const AniListDate = Schema.Struct({
	day: Schema.NullOr(Schema.Int),
	year: Schema.NullOr(Schema.Int),
	month: Schema.NullOr(Schema.Int),
});

const AniListMedia = Schema.Struct({
	title: Schema.optional(
		Schema.NullOr(Schema.Struct({ userPreferred: Schema.optional(Schema.NullOr(Schema.String)) })),
	),
});

const AniListEntryMedia = Schema.Struct({ id: positiveInteger });

const AniListEntryMediaId = Schema.Struct({ mediaId: positiveInteger });

const AniListEntryLabel = Schema.Struct({ media: Schema.optional(Schema.NullOr(AniListMedia)) });

const AniListEntry = Schema.Struct({
	id: positiveInteger,
	status: Schema.String,
	updatedAt: Schema.Int,
	mediaId: positiveInteger,
	repeat: nonNegativeInteger,
	media: Schema.NullOr(AniListMedia),
	startedAt: Schema.NullOr(AniListDate),
	completedAt: Schema.NullOr(AniListDate),
	progress: Schema.NullOr(nonNegativeInteger),
	progressVolumes: Schema.NullOr(nonNegativeInteger),
});

export const AniListGraphQLResponse = Schema.Struct({
	data: Schema.optional(Schema.Unknown),
	errors: Schema.optional(Schema.Array(Schema.Struct({ status: Schema.optional(Schema.Finite) }))),
});

export const AniListViewerData = Schema.Struct({ Viewer: Schema.Struct({ id: positiveInteger }) });

export const AniListCollectionData = Schema.Struct({
	MediaListCollection: Schema.Struct({
		hasNextChunk: Schema.Boolean,
		lists: Schema.Array(Schema.Struct({ entries: Schema.Array(Schema.Unknown) })),
	}),
});

export const anilistEntryIdentity = (value: unknown) =>
	Schema.decodeUnknownOption(AniListEntryMedia)(value);

export const anilistEntryMediaId = (value: unknown, entryId: number) => {
	const media = Schema.decodeUnknownOption(AniListEntryMediaId)(value);
	return Option.isSome(media) ? media.value.mediaId : entryId;
};

export const anilistEntryLabel = (value: unknown, entryId: number) => {
	const label = Schema.decodeUnknownOption(AniListEntryLabel)(value);
	const title = Option.isSome(label) ? label.value.media?.title?.userPreferred?.trim() : undefined;
	return title !== undefined && title.length > 0 ? title : String(entryId);
};

const partialDate = (value: typeof AniListDate.Type | null) => {
	if (value === null) {
		return undefined;
	}
	const date = {
		...(value.day === null ? {} : { day: value.day }),
		...(value.month === null ? {} : { month: value.month }),
		...(value.year === null ? {} : { year: value.year }),
	};
	return Object.keys(date).length ? date : undefined;
};

const stateForStatus = (status: string): ListStateProperties["state"] | undefined => {
	switch (status) {
		case "PLANNING":
			return "backlog";
		case "CURRENT":
		case "REPEATING":
			return "in_progress";
		case "COMPLETED":
			return "complete";
		case "PAUSED":
			return "on_hold";
		case "DROPPED":
			return "dropped";
		default:
			return undefined;
	}
};

export const parseAniListEntry = (
	value: unknown,
	input: { mediaType: AniListMediaType; sourceAccountId: string },
) => {
	const decoded = Schema.decodeUnknownOption(AniListEntry)(value);
	if (Option.isNone(decoded)) {
		return Option.none();
	}
	const entry = decoded.value;
	const state = stateForStatus(entry.status);
	const updatedAt = DateTime.make(entry.updatedAt * 1_000);
	if (!state || Option.isNone(updatedAt)) {
		return Option.none();
	}
	const completedDate = partialDate(entry.completedAt);
	const startedDate = partialDate(entry.startedAt);
	const properties = {
		...(input.mediaType === "ANIME" && entry.progress !== null
			? { animeEpisode: entry.progress }
			: {}),
		...(completedDate ? { completedDate } : {}),
		...(input.mediaType === "MANGA" && entry.progress !== null
			? { mangaChapter: entry.progress }
			: {}),
		...(input.mediaType === "MANGA" && entry.progressVolumes !== null
			? { mangaVolume: entry.progressVolumes }
			: {}),
		source: "anilist",
		repeatCount: entry.repeat,
		sourceEntryId: String(entry.id),
		sourceAccountId: input.sourceAccountId,
		sourceUpdatedAt: DateTime.formatIso(updatedAt.value),
		...(startedDate ? { startedDate } : {}),
		state,
	};
	const decodedProperties = Schema.decodeUnknownOption(ListStatePropertiesSchema)(properties);
	return Option.map(decodedProperties, (listStateProperties) => ({
		entry,
		properties: listStateProperties,
	}));
};

const sameDate = (
	left: ListStateProperties["startedDate"],
	right: ListStateProperties["startedDate"],
) =>
	left === undefined
		? right === undefined
		: right !== undefined &&
			left.day === right.day &&
			left.month === right.month &&
			left.year === right.year;

export const sameAniListState = (left: ListStateProperties, right: ListStateProperties) =>
	left.state === right.state &&
	left.repeatCount === right.repeatCount &&
	left.animeEpisode === right.animeEpisode &&
	left.mangaChapter === right.mangaChapter &&
	left.mangaVolume === right.mangaVolume &&
	sameDate(left.startedDate, right.startedDate) &&
	sameDate(left.completedDate, right.completedDate);
