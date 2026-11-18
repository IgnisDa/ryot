import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { EntityId } from "@ryot-app/plugin-kit/schema";

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
			return {
				output: { count: entry.readingCount },
				changes: {
					entities: {
						deletes: [{ entityId: EntityId.make(entry.id), entitySchemaSlug: "measurement-entry" }],
					},
				},
			};
		}),
});
