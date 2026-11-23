import { existingEntity } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation, OperationRejectedError } from "@ryot-app/plugin-backend-sdk/operation";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import {
	MEASUREMENT_PIN_LIMIT,
	MeasurementMetricPinInput,
	MeasurementMetricPinOutput,
} from "../../shared/measurement-metric-operations";
import { catalogMessage } from "../../shared/messages.generated";
import { measurementMetricPinChanges, pinnedMeasurementMetricIds } from "./measurement-pins";
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
				return yield* new OperationRejectedError({
					reason: catalogMessage("rejection.measurement-metric.pin-limit", {
						limit: MEASUREMENT_PIN_LIMIT,
					}),
				});
			}
			const changes = yield* measurementMetricPinChanges(
				{ pinned: input.pinned, metric: existingEntity(EntityId.make(input.metricId)) },
				host.executeRyotql,
			);
			return { output, changes };
		}),
});
