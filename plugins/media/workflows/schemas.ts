import { Schema } from "@ryot/sandbox-sdk/workflow";

export const mediaImportResolutionActivitySlugByProvider = {
	"book.google-books": "activity.media-import-resolve.book.google-books",
	"book.hardcover": "activity.media-import-resolve.book.hardcover",
	"book.openlibrary": "activity.media-import-resolve.book.openlibrary",
	"movie.tmdb": "activity.media-import-resolve.movie.tmdb",
	"show.tmdb": "activity.media-import-resolve.show.tmdb",
} as const;

export const MediaImportResolutionActivityInput = Schema.Struct({
	value: Schema.String,
	identifierType: Schema.String,
});

export const MediaImportResolutionActivityResult = Schema.Union(
	Schema.Struct({ externalId: Schema.NullOr(Schema.String), status: Schema.Literal("completed") }),
	Schema.Struct({ message: Schema.String, status: Schema.Literal("failed") }),
);

const MediaImportResolutionCandidate = Schema.Struct({
	providerSlug: Schema.String,
	scriptSlug: Schema.String,
});

export const MediaImportResolutionWorkflowInput = Schema.Struct({
	items: Schema.Array(
		Schema.Struct({
			index: Schema.Number,
			value: Schema.String,
			identifierType: Schema.String,
			candidates: Schema.Array(MediaImportResolutionCandidate),
		}),
	),
});

export const MediaImportResolutionWorkflowOutput = Schema.Struct({
	results: Schema.Array(
		Schema.Union(
			Schema.Struct({
				index: Schema.Number,
				status: Schema.Literal("resolved"),
				externalId: Schema.String,
				providerSlug: Schema.String,
			}),
			Schema.Struct({
				index: Schema.Number,
				status: Schema.Literal("unresolved"),
				errors: Schema.Array(Schema.String),
			}),
		),
	),
});

const AutomationOrigin = Schema.Union(
	Schema.Struct({ kind: Schema.Literal("import"), importRunId: Schema.String }),
	Schema.Struct({
		kind: Schema.Literal("integration"),
		importRunId: Schema.String,
		integrationId: Schema.String,
	}),
);

export const MediaImportPopulationWorkflowInput = Schema.Struct({
	items: Schema.Array(
		Schema.Union(
			Schema.Struct({
				index: Schema.Number,
				origin: AutomationOrigin,
				externalId: Schema.String,
				providerId: Schema.String,
				entitySchemaSlug: Schema.String,
				userId: Schema.optional(Schema.String),
			}),
			Schema.Struct({
				index: Schema.Number,
				origin: AutomationOrigin,
				externalId: Schema.String,
				providerSlug: Schema.String,
				entitySchemaSlug: Schema.String,
			}),
		),
	),
});

export const KernelLibraryEntityImportResult = Schema.Union(
	Schema.Struct({
		status: Schema.Literal("completed"),
		entity: Schema.Struct({ id: Schema.String }),
	}),
	Schema.Struct({
		message: Schema.String,
		status: Schema.Literal("failed"),
		stage: Schema.Literal("population", "membership"),
	}),
);

export const MediaImportPopulationWorkflowOutput = Schema.Struct({
	results: Schema.Array(
		Schema.Union(
			Schema.Struct({
				index: Schema.Number,
				entityId: Schema.String,
				status: Schema.Literal("completed"),
			}),
			Schema.Struct({
				index: Schema.Number,
				message: Schema.String,
				status: Schema.Literal("failed"),
				stage: Schema.Literal("population", "membership"),
			}),
		),
	),
});
