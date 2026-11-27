import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

import {
	MeasurementReadingDeleteInput,
	MeasurementReadingOutput,
} from "../../shared/measurement-reading-operations";
import { requireMeasurementEntry } from "./measurement-readings";

export const manifest = defineManifest({
	kind: "operation",
	name: "Delete measurement readings",
	slug: "operation.measurement-reading-delete",
});

export default defineOperation({
	manifest,
	output: MeasurementReadingOutput,
	input: MeasurementReadingDeleteInput,
	run: (input, host) =>
		Effect.gen(function* () {
			const entry = yield* requireMeasurementEntry(input.entryId, host.executeRyotql);
			yield* host.deleteUserEntity({ entityId: entry.id, entitySchemaSlug: "measurement-entry" });
			return { count: entry.readingCount };
		}),
});
