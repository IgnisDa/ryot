import { recoverPartialCreateEvents } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

import {
	measurementEntryEntity,
	measurementReadingProperties,
} from "../../shared/measurement-properties";
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
	run: ({ values, comment, occurredAt }, host) =>
		Effect.gen(function* () {
			yield* requireMeasurementMetrics(
				values.map(({ metricId }) => metricId),
				host.executeRyotql,
			);
			const { entityId: entryId } = yield* host.createUserEntity(
				measurementEntryEntity(occurredAt, comment),
			);
			return yield* host
				.createEvents(
					values.map(({ value, metricId }) => ({
						occurredAt,
						entityId: metricId,
						sessionEntityId: entryId,
						eventSchemaSlug: "measurement-reading",
						properties: measurementReadingProperties(value),
					})),
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
