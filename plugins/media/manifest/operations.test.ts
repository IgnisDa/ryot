import { expect, test } from "bun:test";

import { operationJsonSchema } from "@ryot-app/plugin-kit/operations";

import operation0 from "../backend/operations/media-activity-delete.sandbox";
import operation1 from "../backend/operations/media-activity-log.sandbox";
import operation2 from "../backend/operations/media-activity-update.sandbox";
import operation3 from "../backend/operations/media-monitoring-disable.sandbox";
import operation4 from "../backend/operations/media-monitoring-enable.sandbox";
import operation5 from "../backend/operations/media-monitoring-status.sandbox";
import operation6 from "../backend/operations/media-ownership-set.sandbox";
import operation7 from "../backend/operations/media-review-create.sandbox";
import operation8 from "../backend/operations/media-review-delete.sandbox";
import operation9 from "../backend/operations/media-review-update.sandbox";
import operation10 from "../backend/operations/media-user-data.sandbox";
import operation11 from "../backend/operations/metadata-lookup.sandbox";
import operation12 from "../backend/operations/resolve-episodes.sandbox";
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
