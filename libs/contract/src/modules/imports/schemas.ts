import { Schema } from "effect";

import { ImportRunId } from "../../schema/brands";
import { HttpUrl } from "../../schema/utils";
import { importRunFailureStages, importRunStatuses } from "./types";

const ImportRunStatus = Schema.Literal(...importRunStatuses);

export const ImportRunFailureStage = Schema.Literal(...importRunFailureStages);

const InputSummary = Schema.Record({ key: Schema.String, value: Schema.Unknown });

export const ListedImportRun = Schema.Struct({
	id: ImportRunId,
	source: Schema.String,
	status: ImportRunStatus,
	progress: Schema.Number,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	failedItems: Schema.Number,
	inputSummary: InputSummary,
	importedItems: Schema.Number,
	processedItems: Schema.Number,
	startedAt: Schema.NullOr(Schema.String),
	finishedAt: Schema.NullOr(Schema.String),
	totalItems: Schema.NullOr(Schema.Number),
	errorSummary: Schema.NullOr(Schema.String),
});

export type ListedImportRun = typeof ListedImportRun.Type;

const ListedImportRunFailure = Schema.Struct({
	id: Schema.String,
	runId: ImportRunId,
	message: Schema.String,
	createdAt: Schema.String,
	itemIndex: Schema.Number,
	stage: ImportRunFailureStage,
	context: Schema.NullOr(InputSummary),
	sourceLabel: Schema.NullOr(Schema.String),
	eventSchemaSlug: Schema.NullOr(Schema.String),
	sourceIdentifier: Schema.NullOr(Schema.String),
	entitySchemaSlug: Schema.NullOr(Schema.String),
});

export type ListedImportRunFailure = typeof ListedImportRunFailure.Type;

export const DetailedImportRun = Schema.Struct({
	...ListedImportRun.fields,
	failures: Schema.Struct({
		page: Schema.Number,
		total: Schema.Number,
		limit: Schema.Number,
		items: Schema.Array(ListedImportRunFailure),
	}),
});

export type DetailedImportRun = typeof DetailedImportRun.Type;

const uploadTokenInput = <const S extends string>(source: S) =>
	Schema.Struct({ source: Schema.Literal(source), uploadToken: Schema.NonEmptyString }).pipe(
		Schema.annotations({ identifier: `ImportInput_${source}` }),
	);

const urlAndKeyInput = <const S extends string>(source: S) =>
	Schema.Struct({
		apiUrl: HttpUrl,
		source: Schema.Literal(source),
		apiKey: Schema.NonEmptyString,
		allowInsecureConnections: Schema.optional(Schema.Boolean),
	}).pipe(Schema.annotations({ identifier: `ImportInput_${source}` }));

export const CreateImportRunBody = Schema.Union(
	uploadTokenInput("hevy"),
	uploadTokenInput("imdb"),
	uploadTokenInput("grouvee"),
	uploadTokenInput("anilist"),
	uploadTokenInput("watcharr"),
	uploadTokenInput("hardcover"),
	uploadTokenInput("goodreads"),
	uploadTokenInput("open_scale"),
	uploadTokenInput("storygraph"),
	uploadTokenInput("strong_app"),
	Schema.Struct({
		source: Schema.Literal("igdb"),
		uploadToken: Schema.NonEmptyString,
		collection: Schema.NonEmptyString,
	}).pipe(Schema.annotations({ identifier: "ImportInput_igdb" })),
	Schema.Struct({
		source: Schema.Literal("netflix"),
		uploadToken: Schema.NonEmptyString,
		profileName: Schema.optional(Schema.String),
	}).pipe(Schema.annotations({ identifier: "ImportInput_netflix" })),
	Schema.Struct({
		source: Schema.Literal("movary"),
		historyUploadToken: Schema.NonEmptyString,
		ratingsUploadToken: Schema.NonEmptyString,
		watchlistUploadToken: Schema.NonEmptyString,
	}).pipe(Schema.annotations({ identifier: "ImportInput_movary" })),
	Schema.Struct({
		source: Schema.Literal("myanimelist"),
		animeUploadToken: Schema.optional(Schema.NonEmptyString),
		mangaUploadToken: Schema.optional(Schema.NonEmptyString),
	}).pipe(Schema.annotations({ identifier: "ImportInput_myanimelist" })),
	Schema.Struct({ source: Schema.Literal("trakt"), username: Schema.NonEmptyString }).pipe(
		Schema.annotations({ identifier: "ImportInput_trakt" }),
	),
	urlAndKeyInput("plex"),
	urlAndKeyInput("media_tracker"),
	urlAndKeyInput("audiobookshelf"),
	Schema.Struct({
		apiUrl: HttpUrl,
		username: Schema.NonEmptyString,
		source: Schema.Literal("jellyfin"),
		password: Schema.optional(Schema.NonEmptyString),
		allowInsecureConnections: Schema.optional(Schema.Boolean),
	}).pipe(Schema.annotations({ identifier: "ImportInput_jellyfin" })),
);

export type CreateImportRunBody = typeof CreateImportRunBody.Type;

export const GetImportRunParams = Schema.Struct({
	page: Schema.optional(Schema.NumberFromString),
	limit: Schema.optional(Schema.NumberFromString),
});
