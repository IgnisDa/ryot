import { describe, expect, it } from "@effect/vitest";
import type { ChangeUserRelationshipBatch } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";

import pinDefinition, { manifest } from "./measurement-metric-pin.sandbox";
import { MeasurementMetricPinLimitError } from "./measurement-pins";
import { MeasurementMetricNotFoundError } from "./measurement-readings";
import { measurementRyotql, measurementTables } from "./measurement-readings.test-support";

const execution = { metadata: {}, sandboxScriptId: "script-test" };

const pin = (metricId: string) => ({
	sourceEntityId: metricId,
	targetEntityId: "library",
	relationshipSchemaSlug: "measurement-metric-pinned",
});

const recordingHost = (changes: ChangeUserRelationshipBatch[], pinnedIds: readonly string[]) =>
	defineSandboxTestHost(manifest, {
		changeUserRelationships: (batches) =>
			Effect.sync(() => {
				changes.push(...batches);
				return batches.map(() => ({ created: 0, deleted: 0 }));
			}),
		executeRyotql: measurementRyotql({
			...measurementTables,
			relationship: pinnedIds.map((metricId) => ({
				id: `pin-${metricId}`,
				...pin(metricId),
				relationshipSchemaPluginId: "fitness-owner",
			})),
			entity: [
				...(measurementTables.entity ?? []),
				{
					id: "hip",
					entitySchemaPluginId: "fitness-owner",
					entitySchemaSlug: "measurement-metric",
				},
				{
					id: "bmi",
					entitySchemaPluginId: "fitness-owner",
					entitySchemaSlug: "measurement-metric",
				},
			],
		}),
	});

describe("measurement metric pin operation", () => {
	it.live("pins and unpins metrics, skipping writes when the state already matches", () =>
		Effect.gen(function* () {
			const changes: ChangeUserRelationshipBatch[] = [];
			const host = recordingHost(changes, ["weight"]);

			for (const input of [
				{ pinned: true, metricId: "waist" },
				{ pinned: false, metricId: "weight" },
				{ pinned: true, metricId: "weight" },
				{ pinned: false, metricId: "waist" },
			]) {
				expect(yield* runSandboxTestScript(pinDefinition, input, host, execution)).toEqual({
					pinned: input.pinned,
				});
			}

			expect(changes).toEqual([
				{ deletes: [], creates: [{ ...pin("waist"), properties: {}, propertiesMode: "merge" }] },
				{ creates: [], deletes: [pin("weight")] },
			]);
		}),
	);

	it.live("rejects a fourth pin and unknown metrics without writing", () =>
		Effect.gen(function* () {
			const changes: ChangeUserRelationshipBatch[] = [];
			const host = recordingHost(changes, ["weight", "waist", "hip"]);

			expect(
				yield* Effect.flip(
					runSandboxTestScript(pinDefinition, { pinned: true, metricId: "bmi" }, host, execution),
				),
			).toBeInstanceOf(MeasurementMetricPinLimitError);
			for (const metricId of ["missing", "exercise-1"]) {
				expect(
					yield* Effect.flip(
						runSandboxTestScript(pinDefinition, { metricId, pinned: true }, host, execution),
					),
				).toBeInstanceOf(MeasurementMetricNotFoundError);
			}

			expect(changes).toEqual([]);
		}),
	);
});
