import {
	deleteEventChange,
	entityUpdateTarget,
	existingEntity,
	rootEntity,
	updateEventChange,
} from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import {
	entityEventScopeRevisionRecipe,
	executeRyotqlRecipe,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import { EntityId, EventId } from "@ryot-app/plugin-kit/schema";

import {
	measurementEntryProperties,
	measurementReadingProperties,
} from "../../shared/measurement-properties";
import {
	MeasurementReadingOutput,
	MeasurementReadingUpdateInput,
} from "../../shared/measurement-reading-operations";
import {
	readMeasurementEntryReadings,
	requireMeasurementEntry,
	requireMeasurementMetrics,
} from "./measurement-readings";

export const manifest = defineManifest({
	kind: "operation",
	name: "Update measurement readings",
	slug: "operation.measurement-reading-update",
});

export default defineOperation({
	manifest,
	output: MeasurementReadingOutput,
	input: MeasurementReadingUpdateInput,
	run: ({ values, comment, entryId, occurredAt }, host) =>
		Effect.gen(function* () {
			const entry = yield* requireMeasurementEntry(entryId, host.executeRyotql);
			const revision = yield* executeRyotqlRecipe(
				host.executeRyotql,
				entityEventScopeRevisionRecipe,
				{ entityId: entryId },
			);
			const readings = yield* readMeasurementEntryReadings(entryId, host.executeRyotql);
			yield* requireMeasurementMetrics(
				values.map(({ metricId }) => metricId),
				host.executeRyotql,
			);
			const pending = new Map(values.map(({ value, metricId }) => [metricId, value]));
			const changes = readings.map(({ id, metricId }) => {
				const value = pending.get(metricId);
				if (value === undefined) {
					return deleteEventChange(EventId.make(id));
				}
				pending.delete(metricId);
				return updateEventChange(EventId.make(id), {
					occurredAt,
					properties: { remove: [], set: measurementReadingProperties(value) },
				});
			});
			const creates = [...pending].map(([metricId, value]) => ({
				occurredAt,
				session: rootEntity,
				kind: "create" as const,
				itemIdentity: `reading:${metricId}`,
				eventSchemaSlug: "measurement-reading",
				entity: existingEntity(EntityId.make(metricId)),
				properties: measurementReadingProperties(value),
			}));
			return {
				output: { count: changes.length + creates.length },
				changes: {
					events: {
						changes: [...creates, ...changes],
						baselines: [{ revision, entityId: EntityId.make(entryId) }],
					},
					entity: {
						name: entry.name,
						entitySchemaSlug: "measurement-entry",
						target: entityUpdateTarget({ ...entry, id: entryId }),
						properties: measurementEntryProperties(occurredAt, comment),
					},
				},
			};
		}),
});
