import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId } from "@ryot-app/plugin-kit/schema";

export const mediaActivityStatuses = ["backlog", "on_hold", "dropped"] as const;

export const MAX_ACTIVITY_EPISODES = 500;

const MAX_ACTIVITY_DELETE_EVENTS = 500;

const IsoTimestamp = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter(
			(value) => Number.isFinite(Date.parse(value)) || "Expected a valid timestamp",
		),
	),
);

const NonEmptyString = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((value) => value.trim().length > 0 || "Expected a nonblank value"),
	),
);

const ConsumedOnText = Schema.Trim.pipe(
	Schema.check(Schema.isMinLength(1)),
	Schema.check(Schema.isMaxLength(100)),
);

const ConsumedOn = Schema.optional(ConsumedOnText);

const TimeSpent = Schema.Finite.pipe(Schema.check(Schema.isGreaterThan(0)));

const ProgressPosition = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1)));

const ProgressPercent = Schema.Finite.pipe(
	Schema.check(Schema.isGreaterThan(0)),
	Schema.check(Schema.isLessThanOrEqualTo(100)),
);

const SubmissionId = NonEmptyString.pipe(Schema.check(Schema.isMaxLength(96)));

export const MediaActivityWhen = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("now") }),
	Schema.Struct({ kind: Schema.Literal("unknown") }),
	Schema.Struct({
		finishedOn: IsoTimestamp,
		kind: Schema.Literal("date"),
		startedOn: Schema.optional(IsoTimestamp),
	}),
]);

export type MediaActivityWhen = typeof MediaActivityWhen.Type;

export const MediaActivityEntry = Schema.Union([
	Schema.Struct({
		consumedOn: ConsumedOn,
		when: MediaActivityWhen,
		entityId: NonEmptyString,
		kind: Schema.Literal("complete"),
		timeSpent: Schema.optional(TimeSpent),
	}),
	Schema.Struct({
		consumedOn: ConsumedOn,
		entityId: NonEmptyString,
		kind: Schema.Literal("progress"),
		position: Schema.optional(ProgressPosition),
		progressPercent: Schema.optional(ProgressPercent),
	}).pipe(
		Schema.check(
			Schema.makeFilter(
				({ position, progressPercent }) =>
					position === undefined ||
					progressPercent === undefined ||
					"Progress is either a position or a percent",
			),
		),
	),
	Schema.Struct({
		entityId: NonEmptyString,
		kind: Schema.Literal("status"),
		status: Schema.Literals(mediaActivityStatuses),
	}),
	Schema.Struct({
		consumedOn: ConsumedOn,
		when: MediaActivityWhen,
		parentEntityId: NonEmptyString,
		kind: Schema.Literal("episodes"),
		episodeEntityIds: Schema.Array(NonEmptyString).pipe(
			Schema.check(Schema.isMinLength(1)),
			Schema.check(Schema.isMaxLength(MAX_ACTIVITY_EPISODES)),
			Schema.check(Schema.isUnique()),
		),
	}),
]);

export type MediaActivityEntry = typeof MediaActivityEntry.Type;

const whenIsOrdered = (when: MediaActivityWhen | MediaActivityEditWhen, submittedAt: number) => {
	if (when.kind !== "date") {
		return true;
	}
	const finishedOn = Date.parse(when.finishedOn);
	return (
		finishedOn <= submittedAt &&
		(when.startedOn === undefined || Date.parse(when.startedOn) <= finishedOn)
	);
};

export const MediaActivityLogInput = Schema.Struct({
	entry: MediaActivityEntry,
	submittedAt: IsoTimestamp,
	submissionId: SubmissionId,
}).pipe(
	Schema.check(
		Schema.makeFilter(({ entry, submittedAt }) =>
			"when" in entry
				? whenIsOrdered(entry.when, Date.parse(submittedAt)) ||
					"Dates must satisfy started on <= finished on <= now"
				: true,
		),
	),
);

export type MediaActivityLogInput = typeof MediaActivityLogInput.Type;

export const MediaActivityLogOutput = Schema.Struct({
	count: Schema.Int,
	status: Schema.Literals(["saved", "incomplete"]),
});

export type MediaActivityLogOutput = typeof MediaActivityLogOutput.Type;

const MediaActivityEditWhen = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("unknown") }),
	Schema.Struct({
		finishedOn: IsoTimestamp,
		kind: Schema.Literal("date"),
		startedOn: Schema.optional(IsoTimestamp),
	}),
]);

type MediaActivityEditWhen = typeof MediaActivityEditWhen.Type;

export const mediaSubmissionFields = { submittedAt: IsoTimestamp, submissionId: SubmissionId };

export const MediaEventSnapshot = Schema.Struct({
	entityId: EntityId,
	occurredAt: IsoTimestamp,
	sessionEntityId: Schema.NullOr(EntityId),
	properties: Schema.Record(Schema.String, Schema.Json),
	absentProperties: Schema.Array(Schema.String).pipe(
		Schema.check(Schema.isMaxLength(100)),
		Schema.check(Schema.isUnique()),
	),
});

export type MediaEventSnapshot = typeof MediaEventSnapshot.Type;

export const MediaActivityPatch = Schema.Struct({
	position: Schema.optional(ProgressPosition),
	when: Schema.optional(MediaActivityEditWhen),
	timeSpent: Schema.optional(Schema.NullOr(TimeSpent)),
	consumedOn: Schema.optional(Schema.NullOr(ConsumedOnText)),
	progressPercent: Schema.optional(Schema.NullOr(ProgressPercent)),
}).pipe(
	Schema.check(
		Schema.makeFilter((patch) => Object.keys(patch).length > 0 || "Expected at least one change"),
	),
	Schema.check(
		Schema.makeFilter(
			({ position, progressPercent }) =>
				position === undefined ||
				progressPercent === undefined ||
				"Progress is either a position or a percent",
		),
	),
);

export type MediaActivityPatch = typeof MediaActivityPatch.Type;

export const MediaActivityUpdateInput = Schema.Struct({
	...mediaSubmissionFields,
	eventId: NonEmptyString,
	patch: MediaActivityPatch,
	expected: MediaEventSnapshot,
}).pipe(
	Schema.check(
		Schema.makeFilter(({ patch, submittedAt }) =>
			patch.when === undefined
				? true
				: whenIsOrdered(patch.when, Date.parse(submittedAt)) ||
					"Dates must satisfy started on <= finished on <= now",
		),
	),
);

export type MediaActivityUpdateInput = typeof MediaActivityUpdateInput.Type;

export const MediaActivityDeleteInput = Schema.Struct({
	...mediaSubmissionFields,
	expected: Schema.optional(MediaEventSnapshot),
	eventIds: Schema.Array(NonEmptyString).pipe(
		Schema.check(Schema.isMinLength(1)),
		Schema.check(Schema.isMaxLength(MAX_ACTIVITY_DELETE_EVENTS)),
		Schema.check(Schema.isUnique()),
	),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			({ eventIds, expected }) =>
				expected === undefined ||
				eventIds.length === 1 ||
				"A precondition applies only to a single deleted record",
		),
	),
);

export type MediaActivityDeleteInput = typeof MediaActivityDeleteInput.Type;
