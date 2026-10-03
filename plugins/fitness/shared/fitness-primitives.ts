import { Schema } from "@ryot-app/plugin-kit/effect";

export const NonEmptyString = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((value) => value.trim().length > 0 || "Expected a nonblank value"),
	),
);

export const IsoTimestamp = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter(
			(value) => Number.isFinite(Date.parse(value)) || "Expected a valid timestamp",
		),
	),
);

export const NonNegativeInt = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

export const NonNegativeNumber = Schema.Finite.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

export const Rpe = Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 10 })));

export const SubmissionEnvelope = Schema.Struct({
	submittedAt: IsoTimestamp,
	submissionId: NonEmptyString.pipe(Schema.check(Schema.isMaxLength(96))),
});
