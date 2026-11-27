import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

import {
	MEASUREMENT_PIN_LIMIT,
	MeasurementMetricPinInput,
	MeasurementMetricPinOutput,
} from "../../shared/measurement-metric-operations";
import {
	changeMeasurementMetricPin,
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
			if (pinnedIds.includes(input.metricId) === input.pinned) {
				return { pinned: input.pinned };
			}
			if (input.pinned && pinnedIds.length >= MEASUREMENT_PIN_LIMIT) {
				return yield* new MeasurementMetricPinLimitError({
					message: `Only ${MEASUREMENT_PIN_LIMIT} measurement metrics can be pinned`,
				});
			}
			yield* changeMeasurementMetricPin(input, host);
			return { pinned: input.pinned };
		}),
});
