import { Schema } from "effect";

export const MigrationReportLevel = Schema.Literals(["info", "warning"]);
export type MigrationReportLevel = Schema.Schema.Type<typeof MigrationReportLevel>;

export const MigrationReportAnomalyCode = Schema.Literals([
	"seen-episode-absent",
	"seen-episode-ambiguous",
	"seen-episode-malformed",
	"review-episode-absent",
	"review-episode-ambiguous",
	"integration-cache-provider-unmapped",
	"integration-cache-entity-unresolved",
	"exercise-ownerless-unreferenced",
	"asset-locator-unresolved",
	"asset-deletion-failed",
	"workout-set-completion-outside-session",
	"workout-active-duration-invalid",
	"workout-energy-invalid",
]);

export type MigrationReportAnomalyCode = Schema.Schema.Type<typeof MigrationReportAnomalyCode>;

// Legacy `seen`, `review` and `application_cache` rows are dropped once the migration finishes, so
// everything an operator needs to understand a skipped record is denormalised here at emission.
const episodeIdentityFields = {
	userId: Schema.String,
	parentName: Schema.String,
	parentEntityId: Schema.String,
	legacyRecordId: Schema.String,
	kind: Schema.Literals(["show", "podcast"]),
	requestedSeason: Schema.NullOr(Schema.String),
	requestedEpisode: Schema.NullOr(Schema.String),
};

const absentFields = {
	...episodeIdentityFields,
	seasonExists: Schema.Boolean,
	availableSummary: Schema.String,
};

const workoutIdentityFields = {
	userId: Schema.String,
	workoutId: Schema.String,
	startedAt: Schema.String,
	endedAt: Schema.NullOr(Schema.String),
};

const integrationCacheIdentityFields = { userId: Schema.String, legacyCacheId: Schema.String };

const ambiguousFields = { ...episodeIdentityFields, candidateCount: Schema.Finite };

export const MigrationReportDetail = Schema.Union([
	Schema.Struct({ ...absentFields, code: Schema.Literal("seen-episode-absent") }),
	Schema.Struct({ ...absentFields, code: Schema.Literal("review-episode-absent") }),
	Schema.Struct({ ...ambiguousFields, code: Schema.Literal("seen-episode-ambiguous") }),
	Schema.Struct({ ...ambiguousFields, code: Schema.Literal("review-episode-ambiguous") }),
	Schema.Struct({ ...episodeIdentityFields, code: Schema.Literal("seen-episode-malformed") }),
	Schema.Struct({
		...integrationCacheIdentityFields,
		legacyProvider: Schema.NullOr(Schema.String),
		providersConsumedOn: Schema.Array(Schema.String),
		code: Schema.Literal("integration-cache-provider-unmapped"),
	}),
	Schema.Struct({
		...integrationCacheIdentityFields,
		parentName: Schema.NullOr(Schema.String),
		requestedSeason: Schema.NullOr(Schema.String),
		legacyMetadataId: Schema.NullOr(Schema.String),
		requestedEpisode: Schema.NullOr(Schema.String),
		code: Schema.Literal("integration-cache-entity-unresolved"),
	}),
	Schema.Struct({
		name: Schema.String,
		source: Schema.String,
		assets: Schema.Unknown,
		muscles: Schema.Unknown,
		equipment: Schema.Unknown,
		legacyRecordId: Schema.String,
		creatorUserId: Schema.NullOr(Schema.String),
		code: Schema.Literal("exercise-ownerless-unreferenced"),
	}),
	Schema.Struct({
		...workoutIdentityFields,
		setOrder: Schema.NullOr(Schema.Finite),
		confirmedAt: Schema.NullOr(Schema.String),
		exerciseOrder: Schema.NullOr(Schema.Finite),
		code: Schema.Literal("workout-set-completion-outside-session"),
	}),
	Schema.Struct({
		...workoutIdentityFields,
		legacyValue: Schema.String,
		code: Schema.Literal("workout-active-duration-invalid"),
	}),
	Schema.Struct({
		...workoutIdentityFields,
		legacyValue: Schema.String,
		legacyEnergyUnit: Schema.NullOr(Schema.String),
		code: Schema.Literal("workout-energy-invalid"),
	}),
]);

export type MigrationReportDetail = Schema.Schema.Type<typeof MigrationReportDetail>;
