import { expect } from "bun:test";

import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { foldEachSubject, FoldInput, FoldOutput } from "@ryot-app/plugin-backend-sdk/folds";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

const manifest = defineManifest({ slug: "fold", name: "Fold", kind: "script" });

const definition = defineScript({
	manifest,
	input: FoldInput,
	output: FoldOutput,
	run: foldEachSubject((subject) =>
		Effect.succeed({
			events: [],
			changes: [],
			relationships: [],
			value: { replayed: subject.changes === null },
		}),
	),
});

it.effect(
	"folds each subject of a run in order and answers with its subject ID",
	() =>
		Effect.gen(function* () {
			const input = yield* Schema.decodeEffect(FoldInput)({
				subjects: [
					{ value: null, absorbed: [], changes: null, subjectEntityId: "first" },
					{ value: null, changes: [], absorbed: [], subjectEntityId: "second" },
				],
			});
			const output = yield* definition.run(input, defineSandboxTestHost(manifest, {}));
			expect(
				output.subjects.map(({ value, subjectEntityId }) => ({ value, subjectEntityId })),
			).toEqual<unknown>([
				{ subjectEntityId: "first", value: { replayed: true } },
				{ subjectEntityId: "second", value: { replayed: false } },
			]);
		}),
	testTimeout,
);
