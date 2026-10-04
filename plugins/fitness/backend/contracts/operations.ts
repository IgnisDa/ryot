import { Schema } from "@ryot-app/sandbox-sdk/effect";

const ExerciseNoteId = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

const ExerciseNoteText = Schema.Trim.pipe(
	Schema.check(Schema.isMinLength(1)),
	Schema.check(Schema.isMaxLength(2000)),
);

const ExerciseNoteRating = Schema.Finite.pipe(
	Schema.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
);

export const ExerciseNoteCreateInput = Schema.Struct({
	text: ExerciseNoteText,
	exerciseId: ExerciseNoteId,
	rating: Schema.optional(ExerciseNoteRating),
});

export type ExerciseNoteCreateInput = Schema.Schema.Type<typeof ExerciseNoteCreateInput>;

export const ExerciseNoteUpdateInput = Schema.Struct({
	noteId: ExerciseNoteId,
	text: ExerciseNoteText,
	rating: Schema.NullOr(ExerciseNoteRating),
});

export type ExerciseNoteUpdateInput = Schema.Schema.Type<typeof ExerciseNoteUpdateInput>;

export const ExerciseNoteDeleteInput = Schema.Struct({ noteId: ExerciseNoteId });

export type ExerciseNoteDeleteInput = Schema.Schema.Type<typeof ExerciseNoteDeleteInput>;

export const ExerciseNoteOutput = Schema.Struct({ count: Schema.Int });

export type ExerciseNoteOutput = Schema.Schema.Type<typeof ExerciseNoteOutput>;
