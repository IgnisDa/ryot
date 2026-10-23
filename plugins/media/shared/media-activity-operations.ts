import { Schema } from "@ryot-app/plugin-kit/effect";

export const mediaActivityStatuses = ["backlog", "on_hold", "dropped"] as const;

export const MAX_ACTIVITY_EPISODES = 500;

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

const ConsumedOn = Schema.optional(
	Schema.Trim.pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(100))),
);

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
		timeSpent: Schema.optional(Schema.Finite.pipe(Schema.check(Schema.isGreaterThan(0)))),
	}),
	Schema.Struct({
		consumedOn: ConsumedOn,
		entityId: NonEmptyString,
		kind: Schema.Literal("progress"),
		position: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1)))),
		progressPercent: Schema.optional(
			Schema.Finite.pipe(
				Schema.check(Schema.isGreaterThan(0)),
				Schema.check(Schema.isLessThanOrEqualTo(100)),
			),
		),
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

const whenIsOrdered = (when: MediaActivityWhen, submittedAt: number) => {
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
	submissionId: NonEmptyString.pipe(Schema.check(Schema.isMaxLength(96))),
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
