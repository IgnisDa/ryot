import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";

import {
	MeasurementReadingDeleteInput,
	MeasurementReadingOutput,
} from "../../shared/measurement-reading-operations";
import { requireMeasurementReadings } from "./measurement-readings";

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
			const readings = yield* requireMeasurementReadings(input.readingIds, host.executeRyotql);
			return yield* host.deleteEvents(readings.map(({ id }) => id));
		}),
});
