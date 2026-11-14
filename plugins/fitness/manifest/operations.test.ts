import { expect, test } from "bun:test";

import { operationJsonSchema } from "@ryot-app/plugin-kit/operations";

import operation0 from "../backend/operations/exercise-merge.sandbox";
import operation1 from "../backend/operations/exercise-note-create.sandbox";
import operation2 from "../backend/operations/exercise-note-delete.sandbox";
import operation3 from "../backend/operations/exercise-note-update.sandbox";
import operation4 from "../backend/operations/exercise-override-update.sandbox";
import operation5 from "../backend/operations/measurement-metric-create.sandbox";
import operation6 from "../backend/operations/measurement-metric-pin.sandbox";
import operation7 from "../backend/operations/measurement-reading-delete.sandbox";
import operation8 from "../backend/operations/measurement-reading-log.sandbox";
import operation9 from "../backend/operations/measurement-reading-update.sandbox";
import operation10 from "../backend/operations/workout-delete.sandbox";
import operation11 from "../backend/operations/workout-editor-context.sandbox";
import operation12 from "../backend/operations/workout-editor-save.sandbox";
import operation13 from "../backend/operations/workout-template-delete.sandbox";
import operation14 from "../backend/operations/workout-time-correction.sandbox";
import plugin from "./plugin";

const scripts = [
	operation0,
	operation1,
	operation2,
	operation3,
	operation4,
	operation5,
	operation6,
	operation7,
	operation8,
	operation9,
	operation10,
	operation11,
	operation12,
	operation13,
	operation14,
];
test("publishes the input and output schemas used by every operation script", () => {
	expect(plugin.operations).toHaveLength(scripts.length);
	for (const script of scripts) {
		const operation = plugin.operations.find(
			(candidate) => candidate.scriptSlug === script.manifest.slug,
		);
		expect(operation?.input).toEqual<unknown>(operationJsonSchema(script.input));
		expect(operation?.output).toEqual<unknown>(operationJsonSchema(script.output));
	}
});
