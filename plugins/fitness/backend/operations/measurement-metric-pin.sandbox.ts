import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import {
	MEASUREMENT_PIN_LIMIT,
	MeasurementMetricPinInput,
	MeasurementMetricPinOutput,
} from "../../shared/measurement-metric-operations";
import {
	measurementMetricPinChanges,
	MeasurementMetricPinLimitError,
	pinnedMeasurementMetricIds,
} from "./measurement-pins";
import { requireMeasurementMetrics } from "./measurement-readings";

export const manifest = defineManifest({
	kind: "operation",
	name: "Pin measurement metric",
	slug: "operation.measurement-metric-pin",
});

export default defineOperation({
	manifest,
	input: MeasurementMetricPinInput,
	output: MeasurementMetricPinOutput,
	run: (input, host) =>
		Effect.gen(function* () {
			yield* requireMeasurementMetrics([input.metricId], host.executeRyotql);
			const pinnedIds = yield* pinnedMeasurementMetricIds(host.executeRyotql);
			const output = { pinned: input.pinned };
			if (pinnedIds.includes(input.metricId) === input.pinned) {
				return { output };
			}
			if (input.pinned && pinnedIds.length >= MEASUREMENT_PIN_LIMIT) {
				return yield* new MeasurementMetricPinLimitError({
					message: `Only ${MEASUREMENT_PIN_LIMIT} measurement metrics can be pinned`,
				});
			}
			const changes = yield* measurementMetricPinChanges(
				{
					pinned: input.pinned,
					metric: { kind: "existing", entityId: EntityId.make(input.metricId) },
				},
				host.executeRyotql,
			);
			return { output, changes };
		}),
});
