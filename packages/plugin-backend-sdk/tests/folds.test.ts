import { expect } from "bun:test";

import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { FoldInput, FoldOutput, foldSubjects } from "@ryot-app/plugin-backend-sdk/folds";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

const manifest = defineManifest({ slug: "fold", name: "Fold", kind: "script" });

const Value = Schema.Struct({ folds: Schema.Int });

const definition = defineScript({
	manifest,
	input: FoldInput,
	output: FoldOutput,
	run: foldSubjects({
		value: Value,
		update: ({ value, changes }) =>
			Effect.succeed({
				events: [],
				changes: [],
				relationships: [],
				value: { folds: value.folds + 100 + changes.length },
			}),
		replay: ({ value, absorbed }) =>
			Effect.succeed({
				events: [],
				changes: [],
				relationships: [],
				value: {
					folds:
						(value?.folds ?? 0) +
						absorbed.reduce((sum, absorbedValue) => sum + absorbedValue.value.folds, 0),
				},
			}),
	}),
});

const run = (subjects: ReadonlyArray<(typeof FoldInput.Encoded)["subjects"][number]>) =>
	Schema.decodeEffect(FoldInput)({ subjects }).pipe(
		Effect.flatMap((input) => definition.run(input, defineSandboxTestHost(manifest, {}))),
	);

it.effect(
	"replays a subject without a value or changes and updates one with both, answering in order",
	() =>
		Effect.gen(function* () {
			const output = yield* run([
				{ value: null, changes: [], absorbed: [], subjectEntityId: "first" },
				{
					changes: null,
					value: { folds: 1 },
					subjectEntityId: "second",
					absorbed: [{ ids: {}, value: { folds: 2 } }],
				},
				{ changes: [], absorbed: [], value: { folds: 1 }, subjectEntityId: "third" },
			]);
			expect(
				output.subjects.map(({ value, subjectEntityId }) => ({ value, subjectEntityId })),
			).toEqual<unknown>([
				{ value: { folds: 0 }, subjectEntityId: "first" },
				{ value: { folds: 3 }, subjectEntityId: "second" },
				{ value: { folds: 101 }, subjectEntityId: "third" },
			]);
		}),
	testTimeout,
);

it.effect(
	"fails a run whose stored or absorbed value does not decode",
	() =>
		Effect.gen(function* () {
			const stored = yield* Effect.exit(
				run([{ changes: [], absorbed: [], value: { folds: "one" }, subjectEntityId: "first" }]),
			);
			const absorbed = yield* Effect.exit(
				run([
					{
						value: null,
						changes: null,
						subjectEntityId: "first",
						absorbed: [{ ids: {}, value: { other: true } }],
					},
				]),
			);
			expect(stored._tag).toBe("Failure");
			expect(absorbed._tag).toBe("Failure");
		}),
	testTimeout,
);
