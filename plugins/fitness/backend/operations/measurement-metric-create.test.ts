import { describe, expect } from "bun:test";

import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { inMemoryRyotql, type StoredTables } from "@ryot-app/ryotql-recipes/test-utils";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import createDefinition, { manifest } from "./measurement-metric-create.sandbox";
import { measurementTables } from "./measurement-ryotql.test-support";

const execution = { metadata: {}, sandboxScriptId: "script-test" };

const recordingHost = (tables: StoredTables = measurementTables) =>
	defineSandboxTestHost(manifest, {
		executeRyotql: inMemoryRyotql({ tables, pluginId: "fitness-owner" }),
	});

const create = (input: { readonly name: string; readonly unit?: string }, tables?: StoredTables) =>
	runSandboxTestScript(createDefinition, input, recordingHost(tables), execution);

const rootEntity = (name: string, properties: Readonly<Record<string, string>>) => ({
	name,
	properties,
	target: { kind: "create" },
	entitySchemaSlug: "measurement-metric",
});

const pinRoot = {
	relationships: {
		upserts: [
			{
				properties: {},
				propertiesMode: "merge",
				source: { kind: "root" },
				target: { kind: "existing", entityId: "library" },
				relationshipSchemaSlug: "measurement-metric-pinned",
			},
		],
	},
};

describe("measurement metric create operation", () => {
	it.live(
		"trims a known metric name and uses its canonical unit when omitted",
		() =>
			Effect.gen(function* () {
				expect(yield* create({ name: "  Weight  " })).toEqual<unknown>({
					output: {},
					changes: { entity: rootEntity("Weight", { unit: "kg", key: "weight" }) },
				});
			}),
		testTimeout,
	);

	it.live(
		"trims custom metric names and units",
		() =>
			Effect.gen(function* () {
				expect(yield* create({ unit: " mmHg ", name: " Blood Pressure " })).toMatchObject({
					changes: {
						entity: rootEntity("Blood Pressure", { unit: "mmHg", key: "blood_pressure" }),
					},
				});
			}),
		testTimeout,
	);

	it.live(
		"omits blank or missing units for custom metrics",
		() =>
			Effect.gen(function* () {
				expect(yield* create({ name: "Resting Heart Rate" })).toMatchObject({
					changes: { entity: rootEntity("Resting Heart Rate", { key: "resting_heart_rate" }) },
				});
				expect(yield* create({ unit: "  ", name: "Body Temperature" })).toMatchObject({
					changes: { entity: rootEntity("Body Temperature", { key: "body_temperature" }) },
				});
			}),
		testTimeout,
	);

	it.live(
		"normalizes whitespace and punctuation before applying a known metric unit",
		() =>
			Effect.gen(function* () {
				expect(yield* create({ name: " Waist " })).toMatchObject({
					changes: { entity: rootEntity("Waist", { unit: "cm", key: "waist" }) },
				});
				expect(yield* create({ name: "Waist!" })).toMatchObject({
					changes: { entity: rootEntity("Waist!", { unit: "cm", key: "waist" }) },
				});
			}),
		testTimeout,
	);

	it.live(
		"does not infer a unit for an unknown metric named Constructor",
		() =>
			Effect.gen(function* () {
				expect(yield* create({ name: "Constructor" })).toMatchObject({
					changes: { entity: rootEntity("Constructor", { key: "constructor" }) },
				});
			}),
		testTimeout,
	);

	it.live(
		"pins the new metric only while the user has fewer than two metrics",
		() =>
			Effect.gen(function* () {
				const oneMetric = {
					...measurementTables,
					entity: (measurementTables.entity ?? []).filter(({ id }) => id !== "waist"),
				};

				expect((yield* create({ name: "Hip" }, oneMetric)).changes).toMatchObject(pinRoot);
				expect((yield* create({ name: "Hip" })).changes?.relationships).toBeUndefined();
			}),
		testTimeout,
	);

	it.live(
		"rejects invalid names and incompatible known units",
		() =>
			Effect.gen(function* () {
				for (const name of ["", "   ", "!!!", "測定"]) {
					yield* Effect.flip(create({ name }));
				}
				yield* Effect.flip(create({ unit: "lb", name: "Weight" }));
			}),
		testTimeout,
	);
});
