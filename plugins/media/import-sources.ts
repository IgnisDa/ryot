import { HttpUrl } from "@ryot/contract/schema/utils";
import { Schema } from "effect";

const uploadTokenInput = <const Source extends string>(source: Source) =>
	Schema.Struct({ source: Schema.Literal(source), uploadToken: Schema.NonEmptyString }).pipe(
		Schema.annotations({ identifier: `MediaImportInput_${source}` }),
	);

const urlAndKeyInput = <const Source extends string>(source: Source) =>
	Schema.Struct({
		apiUrl: HttpUrl,
		apiKey: Schema.NonEmptyString,
		source: Schema.Literal(source),
		allowInsecureConnections: Schema.optional(Schema.Boolean),
	}).pipe(Schema.annotations({ identifier: `MediaImportInput_${source}` }));

export const MediaCreateImportRunBody = Schema.Union(
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
	Schema.Struct({ source: Schema.Literal("trakt"), username: Schema.NonEmptyString }).pipe(
		Schema.annotations({ identifier: "MediaImportInput_trakt" }),
	),
	Schema.Struct({
		source: Schema.Literal("igdb"),
		collection: Schema.NonEmptyString,
		uploadToken: Schema.NonEmptyString,
	}).pipe(Schema.annotations({ identifier: "MediaImportInput_igdb" })),
	Schema.Struct({
		source: Schema.Literal("netflix"),
		uploadToken: Schema.NonEmptyString,
		profileName: Schema.optional(Schema.String),
	}).pipe(Schema.annotations({ identifier: "MediaImportInput_netflix" })),
	Schema.Struct({
		source: Schema.Literal("movary"),
		historyUploadToken: Schema.NonEmptyString,
		ratingsUploadToken: Schema.NonEmptyString,
		watchlistUploadToken: Schema.NonEmptyString,
	}).pipe(Schema.annotations({ identifier: "MediaImportInput_movary" })),
	Schema.Struct({
		source: Schema.Literal("myanimelist"),
		animeUploadToken: Schema.optional(Schema.NonEmptyString),
		mangaUploadToken: Schema.optional(Schema.NonEmptyString),
	}).pipe(Schema.annotations({ identifier: "MediaImportInput_myanimelist" })),
	Schema.Struct({
		apiUrl: HttpUrl,
		username: Schema.NonEmptyString,
		source: Schema.Literal("jellyfin"),
		password: Schema.optional(Schema.NonEmptyString),
		allowInsecureConnections: Schema.optional(Schema.Boolean),
	}).pipe(Schema.annotations({ identifier: "MediaImportInput_jellyfin" })),
);

export type MediaCreateImportRunBody = typeof MediaCreateImportRunBody.Type;

export const createMediaImportRunBody = <const Source extends MediaCreateImportRunBody["source"]>(
	body: Extract<MediaCreateImportRunBody, { readonly source: Source }>,
) => body;
