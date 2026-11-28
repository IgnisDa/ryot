import { describe, expect } from "bun:test";

import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { inMemoryRyotql } from "@ryot-app/ryotql-recipes/test-utils";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import pinDefinition, { manifest } from "./measurement-metric-pin.sandbox";
import { measurementTables } from "./measurement-ryotql.test-support";

const execution = { metadata: {}, sandboxScriptId: "script-test" };

const pin = (metricId: string) => ({
	sourceEntityId: metricId,
	targetEntityId: "library",
	relationshipSchemaSlug: "measurement-metric-pinned",
});

const pinEdge = (metricId: string) => ({
	source: { kind: "existing", entityId: metricId },
	target: { kind: "existing", entityId: "library" },
	relationshipSchemaSlug: "measurement-metric-pinned",
});

const recordingHost = (pinnedIds: readonly string[]) =>
	defineSandboxTestHost(manifest, {
		executeRyotql: inMemoryRyotql({
			pluginId: "fitness-owner",
			tables: {
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
			},
		}),
	});

describe("measurement metric pin operation", () => {
	it.live(
		"pins and unpins metrics, returning no changes when the state already matches",
		() =>
			Effect.gen(function* () {
				const host = recordingHost(["weight"]);
				const run = (input: { readonly pinned: boolean; readonly metricId: string }) =>
					runSandboxTestScript(pinDefinition, input, host, execution);

				expect(yield* run({ pinned: true, metricId: "waist" })).toEqual<unknown>({
					output: { pinned: true },
					changes: {
						relationships: {
							upserts: [{ ...pinEdge("waist"), properties: {}, propertiesMode: "merge" }],
						},
					},
				});
				expect(yield* run({ pinned: false, metricId: "weight" })).toEqual<unknown>({
					output: { pinned: false },
					changes: { relationships: { deletes: [pinEdge("weight")] } },
				});
				expect(yield* run({ pinned: true, metricId: "weight" })).toEqual({
					output: { pinned: true },
				});
				expect(yield* run({ pinned: false, metricId: "waist" })).toEqual({
					output: { pinned: false },
				});
			}),
		testTimeout,
	);

	it.live(
		"rejects a fourth pin and unknown metrics",
		() =>
			Effect.gen(function* () {
				const host = recordingHost(["weight", "waist", "hip"]);

				expect(
					yield* Effect.flip(
						runSandboxTestScript(pinDefinition, { pinned: true, metricId: "bmi" }, host, execution),
					),
				).toMatchObject({
					_tag: "OperationRejectedError",
					reason: { params: { limit: 3 }, key: "rejection.measurement-metric.pin-limit" },
				});
				for (const metricId of ["missing", "exercise-1"]) {
					expect(
						yield* Effect.flip(
							runSandboxTestScript(pinDefinition, { metricId, pinned: true }, host, execution),
						),
					).toMatchObject({
						_tag: "OperationRejectedError",
						reason: { key: "rejection.measurement-metric.missing" },
					});
				}
			}),
		testTimeout,
	);
});
