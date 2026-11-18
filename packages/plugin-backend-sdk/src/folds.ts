import {
	FOLD_LIMITS,
	FoldEventChange,
	FoldEventImage,
	FoldInput,
	FoldOutput,
} from "@ryot-app/contract/modules/events/folds";

export { FoldInput, FoldOutput, FOLD_LIMITS, FoldEventImage, FoldEventChange };

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
