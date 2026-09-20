import { describe, expect, it } from "@effect/vitest";
import type { ChangeUserRelationshipBatch, ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";

import createDefinition, { manifest } from "./measurement-metric-create.sandbox";
import {
	measurementRyotql,
	measurementTables,
	type MeasurementTables,
} from "./measurement-readings.test-support";

const execution = { metadata: {}, sandboxScriptId: "script-test" };

type CreateUserEntityItem = Parameters<ScriptHost["createUserEntity"]>[0];

const recordingHost = (
	writes: CreateUserEntityItem[],
	pins: ChangeUserRelationshipBatch[] = [],
	tables: MeasurementTables = measurementTables,
) =>
	defineSandboxTestHost(manifest, {
		executeRyotql: measurementRyotql(tables),
		createUserEntity: (item) =>
			Effect.sync(() => {
				writes.push(item);
				return { entityId: "metric-1" };
			}),
		changeUserRelationships: (batches) =>
			Effect.sync(() => {
				pins.push(...batches);
				return batches.map(() => ({ created: 1, deleted: 0 }));
			}),
	});

describe("measurement metric create operation", () => {
	it.live("trims a known metric name and uses its canonical unit when omitted", () =>
		Effect.gen(function* () {
			const writes: CreateUserEntityItem[] = [];

			expect(
				yield* runSandboxTestScript(
					createDefinition,
					{ name: "  Weight  " },
					recordingHost(writes),
					execution,
				),
			).toEqual({ entityId: "metric-1" });
			expect(writes).toEqual([
				{
					name: "Weight",
					entitySchemaSlug: "measurement-metric",
					properties: { unit: "kg", key: "weight" },
				},
			]);
		}),
	);

	it.live("trims custom metric names and units", () =>
		Effect.gen(function* () {
			const writes: CreateUserEntityItem[] = [];

			yield* runSandboxTestScript(
				createDefinition,
				{ unit: " mmHg ", name: " Blood Pressure " },
				recordingHost(writes),
				execution,
			);

			expect(writes).toEqual([
				{
					name: "Blood Pressure",
					entitySchemaSlug: "measurement-metric",
					properties: { unit: "mmHg", key: "blood_pressure" },
				},
			]);
		}),
	);

	it.live("omits blank or missing units for custom metrics", () =>
		Effect.gen(function* () {
			const writes: CreateUserEntityItem[] = [];

			yield* runSandboxTestScript(
				createDefinition,
				{ name: "Resting Heart Rate" },
				recordingHost(writes),
				execution,
			);
			yield* runSandboxTestScript(
				createDefinition,
				{ unit: "  ", name: "Body Temperature" },
				recordingHost(writes),
				execution,
			);

			expect(writes).toEqual([
				{
					name: "Resting Heart Rate",
					entitySchemaSlug: "measurement-metric",
					properties: { key: "resting_heart_rate" },
				},
				{
					name: "Body Temperature",
					entitySchemaSlug: "measurement-metric",
					properties: { key: "body_temperature" },
				},
			]);
		}),
	);

	it.live("normalizes whitespace and punctuation before applying a known metric unit", () =>
		Effect.gen(function* () {
			const writes: CreateUserEntityItem[] = [];

			yield* runSandboxTestScript(
				createDefinition,
				{ name: " Waist " },
				recordingHost(writes),
				execution,
			);
			yield* runSandboxTestScript(
				createDefinition,
				{ name: "Waist!" },
				recordingHost(writes),
				execution,
			);

			expect(writes).toEqual([
				{
					name: "Waist",
					entitySchemaSlug: "measurement-metric",
					properties: { unit: "cm", key: "waist" },
				},
				{
					name: "Waist!",
					entitySchemaSlug: "measurement-metric",
					properties: { unit: "cm", key: "waist" },
				},
			]);
		}),
	);

	it.live("does not infer a unit for an unknown metric named Constructor", () =>
		Effect.gen(function* () {
			const writes: CreateUserEntityItem[] = [];

			yield* runSandboxTestScript(
				createDefinition,
				{ name: "Constructor" },
				recordingHost(writes),
				execution,
			);

			expect(writes).toEqual([
				{
					name: "Constructor",
					properties: { key: "constructor" },
					entitySchemaSlug: "measurement-metric",
				},
			]);
		}),
	);

	it.live("pins the new metric only while the user has fewer than two metrics", () =>
		Effect.gen(function* () {
			const pins: ChangeUserRelationshipBatch[] = [];
			const oneMetric = {
				...measurementTables,
				entity: (measurementTables.entity ?? []).filter(({ id }) => id !== "waist"),
			};

			yield* runSandboxTestScript(
				createDefinition,
				{ name: "Hip" },
				recordingHost([], pins, oneMetric),
				execution,
			);
			yield* runSandboxTestScript(
				createDefinition,
				{ name: "Hip" },
				recordingHost([], pins),
				execution,
			);

			expect(pins).toEqual([
				{
					deletes: [],
					creates: [
						{
							properties: {},
							propertiesMode: "merge",
							targetEntityId: "library",
							sourceEntityId: "metric-1",
							relationshipSchemaSlug: "measurement-metric-pinned",
						},
					],
				},
			]);
		}),
	);

	it.live("rejects invalid names and incompatible known units without writing", () =>
		Effect.gen(function* () {
			const writes: CreateUserEntityItem[] = [];
			const host = recordingHost(writes);

			for (const name of ["", "   ", "!!!", "測定"]) {
				yield* Effect.flip(runSandboxTestScript(createDefinition, { name }, host, execution));
			}
			yield* Effect.flip(
				runSandboxTestScript(createDefinition, { unit: "lb", name: "Weight" }, host, execution),
			);

			expect(writes).toEqual([]);
		}),
	);
});
