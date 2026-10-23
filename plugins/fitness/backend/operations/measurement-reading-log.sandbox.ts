import { recoverPartialCreateEvents } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

import { measurementReadingProperties } from "../../shared/measurement-properties";
import {
	MeasurementReadingLogInput,
	MeasurementReadingLogOutput,
} from "../../shared/measurement-reading-operations";
import { requireMeasurementMetrics } from "./measurement-readings";

export const manifest = defineManifest({
	kind: "operation",
	name: "Log measurement readings",
	slug: "operation.measurement-reading-log",
});

export default defineOperation({
	manifest,
	input: MeasurementReadingLogInput,
	output: MeasurementReadingLogOutput,
	run: ({ values, comment, occurredAt, submittedAt, submissionId }, host) =>
		Effect.gen(function* () {
			yield* requireMeasurementMetrics(
				values.map(({ metricId }) => metricId),
				host.executeRyotql,
			);
			return yield* host
				.createEvents(
					values.map(({ value, metricId }) => ({
						occurredAt,
						entityId: metricId,
						eventSchemaSlug: "measurement-reading",
						properties: measurementReadingProperties(value, comment),
					})),
					{ submittedAt, idempotencyKey: submissionId },
				)
				.pipe(
					Effect.map(({ count }) => ({
						count,
						status: count === values.length ? ("saved" as const) : ("incomplete" as const),
					})),
					Effect.catch((error) =>
						recoverPartialCreateEvents(error).pipe(
							Effect.map(({ count }) => ({ count, status: "incomplete" as const })),
						),
					),
				);
		}),
});
