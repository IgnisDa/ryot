import { Schema } from "@ryot-app/plugin-kit/effect";
import { ReviewRating } from "@ryot-app/plugin-kit/schema";

export const exerciseNoteOperationSlugs = {
	create: "exercise-note-create",
	update: "exercise-note-update",
	delete: "exercise-note-delete",
} as const;

const ExerciseNoteId = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

const ExerciseNoteText = Schema.Trim.pipe(
	Schema.check(Schema.isMinLength(1)),
	Schema.check(Schema.isMaxLength(2000)),
);

export const ExerciseNoteCreateInput = Schema.Struct({
	text: ExerciseNoteText,
	exerciseId: ExerciseNoteId,
	rating: Schema.optional(ReviewRating),
});

export type ExerciseNoteCreateInput = Schema.Schema.Type<typeof ExerciseNoteCreateInput>;

export const ExerciseNoteUpdateInput = Schema.Struct({
	noteId: ExerciseNoteId,
	text: ExerciseNoteText,
	rating: Schema.NullOr(ReviewRating),
});

export type ExerciseNoteUpdateInput = Schema.Schema.Type<typeof ExerciseNoteUpdateInput>;

export const ExerciseNoteDeleteInput = Schema.Struct({ noteId: ExerciseNoteId });

export type ExerciseNoteDeleteInput = Schema.Schema.Type<typeof ExerciseNoteDeleteInput>;

export const ExerciseNoteOutput = Schema.Struct({ count: Schema.Int });

export type ExerciseNoteOutput = Schema.Schema.Type<typeof ExerciseNoteOutput>;
