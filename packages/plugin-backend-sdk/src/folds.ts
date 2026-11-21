import {
	FOLD_LIMITS,
	FoldEventChange,
	FoldEventImage,
	FoldInput,
	FoldOutput,
	FoldResult,
	FoldSubjectInput,
} from "@ryot-app/contract/modules/events/folds";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

import type { ScriptHost } from "./core/script-host";

export {
	FoldInput,
	FoldOutput,
	FoldResult,
	FOLD_LIMITS,
	FoldEventImage,
	FoldEventChange,
	FoldSubjectInput,
};

/** A fold run's `run` that folds each subject in turn with `fold`, which returns that subject's result. */
export const foldEachSubject =
	<E>(fold: (subject: FoldSubjectInput, host: ScriptHost) => Effect.Effect<FoldResult, E>) =>
	(input: FoldInput, host: ScriptHost): Effect.Effect<FoldOutput, E> =>
		Effect.map(
			Effect.forEach(input.subjects, (subject) =>
				Effect.map(fold(subject, host), (result) => ({
					...result,
					subjectEntityId: subject.subjectEntityId,
				})),
			),
			(subjects) => ({ subjects }),
		);

/**
 * Splits an incremental fold's change list: `retracted` holds what left the subject's history (deleted
 * events and the old side of updates), `added` what joined it, and `ids` every changed event.
 */
export const foldChangeImages = (changes: ReadonlyArray<FoldEventChange>) => ({
	added: changes.flatMap(({ after }) => (after ? [after] : [])),
	retracted: changes.flatMap(({ before }) => (before ? [before] : [])),
	ids: new Set<string>(
		changes.flatMap(({ after, before }) =>
			[before?.id, after?.id].flatMap((id) => (id === undefined ? [] : [id])),
		),
	),
});
