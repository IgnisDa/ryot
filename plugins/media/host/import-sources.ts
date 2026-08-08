import { HttpUrl, strictStruct } from "@ryot-app/contract/schema/utils";
import { Schema } from "effect";

const uploadTokenInput = <const Source extends string>(source: Source) =>
	strictStruct({ source: Schema.Literal(source), uploadToken: Schema.NonEmptyString }).pipe(
		Schema.annotate({ identifier: `MediaImportInput_${source}` }),
	);

const urlAndKeyInput = <const Source extends string>(source: Source) =>
	strictStruct({
		apiUrl: HttpUrl,
		apiKey: Schema.NonEmptyString,
		source: Schema.Literal(source),
		allowInsecureConnections: Schema.optional(Schema.NullOr(Schema.Boolean)),
	}).pipe(Schema.annotate({ identifier: `MediaImportInput_${source}` }));

const traktUserInput = strictStruct({
	mode: Schema.Literal("user"),
	username: Schema.NonEmptyString,
	source: Schema.Literal("trakt"),
}).pipe(Schema.annotate({ identifier: "MediaImportInput_trakt_user" }));

const traktListInput = strictStruct({
	url: HttpUrl,
	mode: Schema.Literal("list"),
	source: Schema.Literal("trakt"),
	collection: Schema.NonEmptyString,
}).pipe(Schema.annotate({ identifier: "MediaImportInput_trakt_list" }));

export const MediaCreateImportRunBody = Schema.Union([
	urlAndKeyInput("plex"),
	uploadTokenInput("imdb"),
	uploadTokenInput("grouvee"),
	uploadTokenInput("anilist"),
	uploadTokenInput("watcharr"),
	uploadTokenInput("hardcover"),
	uploadTokenInput("goodreads"),
	uploadTokenInput("storygraph"),
	urlAndKeyInput("media_tracker"),
	urlAndKeyInput("audiobookshelf"),
	traktUserInput,
	traktListInput,
	strictStruct({
		source: Schema.Literal("igdb"),
		collection: Schema.NonEmptyString,
		uploadToken: Schema.NonEmptyString,
	}).pipe(Schema.annotate({ identifier: "MediaImportInput_igdb" })),
	strictStruct({
		source: Schema.Literal("netflix"),
		uploadToken: Schema.NonEmptyString,
		profileName: Schema.optional(Schema.NullOr(Schema.String)),
	}).pipe(Schema.annotate({ identifier: "MediaImportInput_netflix" })),
	strictStruct({
		source: Schema.Literal("movary"),
		historyUploadToken: Schema.NonEmptyString,
		ratingsUploadToken: Schema.NonEmptyString,
		watchlistUploadToken: Schema.NonEmptyString,
	}).pipe(Schema.annotate({ identifier: "MediaImportInput_movary" })),
	strictStruct({
		mode: Schema.Literal("export"),
		source: Schema.Literal("trakt"),
		exportUploadToken: Schema.NonEmptyString,
	}).pipe(Schema.annotate({ identifier: "MediaImportInput_trakt_export" })),
	strictStruct({
		source: Schema.Literal("myanimelist"),
		animeUploadToken: Schema.optional(Schema.NonEmptyString),
		mangaUploadToken: Schema.optional(Schema.NonEmptyString),
	}).pipe(
		Schema.check(
			Schema.makeFilter(({ animeUploadToken, mangaUploadToken }) =>
				animeUploadToken !== undefined || mangaUploadToken !== undefined
					? true
					: "At least one MyAnimeList export is required",
			),
		),
		Schema.annotate({ identifier: "MediaImportInput_myanimelist" }),
	),
	strictStruct({
		apiUrl: HttpUrl,
		username: Schema.NonEmptyString,
		source: Schema.Literal("jellyfin"),
		password: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
		allowInsecureConnections: Schema.optional(Schema.NullOr(Schema.Boolean)),
	}).pipe(Schema.annotate({ identifier: "MediaImportInput_jellyfin" })),
]);

export type MediaCreateImportRunBody = typeof MediaCreateImportRunBody.Type;

export const createMediaImportRunBody = <const Source extends MediaCreateImportRunBody["source"]>(
	body: Extract<MediaCreateImportRunBody, { readonly source: Source }>,
) => body;
