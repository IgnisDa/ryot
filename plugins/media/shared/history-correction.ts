import { Schema } from "@ryot-app/plugin-kit/effect";

export const CompletionOccurrence = Schema.Struct({
	total: Schema.Finite,
	runKey: Schema.String,
	frozen: Schema.Boolean,
	silent: Schema.Boolean,
	entityId: Schema.String,
	subjectEntityId: Schema.String,
	rule: Schema.Literals(["progress", "coverage"]),
	sourceEventId: Schema.optionalKey(Schema.String),
	sessionEntityId: Schema.optionalKey(Schema.String),
	expectedOrderKey: Schema.optionalKey(Schema.String),
	expectedOccurredAt: Schema.optionalKey(Schema.String),
	expectedConsumedOn: Schema.optionalKey(Schema.String),
	expectedDateUnknown: Schema.optionalKey(Schema.Boolean),
	expectedOrderCreatedAt: Schema.optionalKey(Schema.String),
	status: Schema.Literals(["building", "active", "inactive", "suppressed", "overridden"]),
});
export type CompletionOccurrence = typeof CompletionOccurrence.Type;

export const CompletionEpisode = Schema.Struct({
	episodeId: Schema.String,
	occurrenceId: Schema.String,
	subjectEntityId: Schema.String,
	sourceEventId: Schema.optionalKey(Schema.String),
});
export type CompletionEpisode = typeof CompletionEpisode.Type;

export const HistoryCoverage = Schema.Struct({
	cycle: Schema.Int,
	runKey: Schema.String,
	episodeId: Schema.String,
	sourceEventId: Schema.String,
	subjectEntityId: Schema.String,
	consumedOn: Schema.optionalKey(Schema.String),
	dateUnknown: Schema.optionalKey(Schema.Boolean),
});
export type HistoryCoverage = typeof HistoryCoverage.Type;

export const HistoryCorrection = Schema.Struct({
	step: Schema.Int,
	cycle: Schema.Int,
	runKey: Schema.String,
	workKey: Schema.String,
	requestKey: Schema.String,
	sourceRevision: Schema.Int,
	subjectEntityId: Schema.String,
	after: Schema.optionalKey(Schema.String),
	basisId: Schema.optionalKey(Schema.String),
	userRevision: Schema.optionalKey(Schema.Int),
	globalRevision: Schema.optionalKey(Schema.Int),
	evidenceAfter: Schema.optionalKey(Schema.String),
	closingEventId: Schema.optionalKey(Schema.String),
	coverageFinished: Schema.optionalKey(Schema.Boolean),
	liveSourceIds: Schema.Array(Schema.String).check(Schema.isMaxLength(60)),
	phase: Schema.Literals([
		"audit",
		"progress",
		"prune",
		"coverage",
		"reset-snapshot",
		"snapshot",
		"publish",
		"clear",
		"sweep",
		"done",
	]),
});
export type HistoryCorrection = typeof HistoryCorrection.Type;
