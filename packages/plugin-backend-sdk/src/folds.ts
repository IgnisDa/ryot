import {
	FOLD_LIMITS,
	FoldEventChange,
	FoldEventImage,
	FoldInput,
	FoldOutput,
	FoldRefresh,
	FoldResult,
	FoldSubjectInput,
} from "@ryot-app/contract/modules/events/folds";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import type { ScriptHost } from "./core/script-host";

export {
	FoldInput,
	FoldOutput,
	FoldResult,
	FoldRefresh,
	FOLD_LIMITS,
	FoldEventImage,
	FoldEventChange,
	FoldSubjectInput,
};

/** A subject's result with its value before encoding. */
export type FoldValueResult<Value> = Omit<FoldResult, "value"> & { readonly value: Value };

type FoldedSubject<Value> = {
	readonly subjectEntityId: FoldSubjectInput["subjectEntityId"];
	readonly absorbed: ReadonlyArray<{
		readonly value: Value;
		readonly ids: FoldSubjectInput["absorbed"][number]["ids"];
	}>;
};

/**
 * A fold run's `run`. `value` decodes what each subject returned last time and the values it
 * absorbed; one that does not decode fails the run. A subject without a value, or whose changes are
 * null, replays; any other updates from its changes.
 */
export const foldSubjects = <Value extends Schema.Codec<unknown, unknown>, E>(definition: {
	readonly value: Value;
	readonly replay: (
		subject: FoldedSubject<Value["Type"]> & { readonly value: null | Value["Type"] },
		host: ScriptHost,
	) => Effect.Effect<FoldValueResult<Value["Type"]>, E>;
	readonly update: (
		subject: FoldedSubject<Value["Type"]> & {
			readonly value: Value["Type"];
			readonly changes: ReadonlyArray<FoldEventChange>;
		},
		host: ScriptHost,
	) => Effect.Effect<FoldValueResult<Value["Type"]>, E>;
}) => {
	const codec = Schema.toCodecJson(definition.value);
	const decode = Schema.decodeUnknownEffect(codec);
	const encode = Schema.encodeEffect(codec);
	return (input: FoldInput, host: ScriptHost) =>
		Effect.map(
			Effect.forEach(input.subjects, ({ value, changes, absorbed, subjectEntityId }) =>
				Effect.gen(function* () {
					const subject = {
						subjectEntityId,
						absorbed: yield* Effect.forEach(absorbed, ({ ids, value: absorbedValue }) =>
							Effect.map(decode(absorbedValue), (decoded) => ({ ids, value: decoded })),
						),
					};
					const previous = value === null ? null : yield* decode(value);
					const folded =
						previous === null || changes === null
							? yield* definition.replay({ ...subject, value: previous }, host)
							: yield* definition.update({ ...subject, changes, value: previous }, host);
					return { ...folded, subjectEntityId, value: yield* encode(folded.value) };
				}),
			),
			(subjects): FoldOutput => ({ subjects }),
		);
};

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
