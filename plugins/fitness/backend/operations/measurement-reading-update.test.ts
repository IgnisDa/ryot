import { describe, expect } from "bun:test";

import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import {
	executeMeasurementRyotql,
	inMemoryRyotql,
	measurementTables,
} from "./in-memory-ryotql.test-support";
import updateDefinition, { manifest } from "./measurement-reading-update.sandbox";
import {
	MeasurementEntryNotFoundError,
	MeasurementMetricNotFoundError,
} from "./measurement-readings";

const execution = { metadata: {}, sandboxScriptId: "script-test" };
const occurredAt = "2026-04-28T07:30:00.000Z";

const defaultHost = defineSandboxTestHost(manifest, { executeRyotql: executeMeasurementRyotql });

const readingUpdate = (eventId: string, value: number) => ({
	kind: "update",
	itemIdentity: `update:${eventId}`,
	item: { eventId, patch: { occurredAt, properties: { remove: [], set: { value } } } },
});

const readingCreate = (metricId: string, value: number) => ({
	occurredAt,
	properties: { value },
	session: { kind: "root" },
	itemIdentity: `reading:${metricId}`,
	eventSchemaSlug: "measurement-reading",
	entity: { kind: "existing", entityId: metricId },
});

const entryUpdate = (entryId: string, properties: Record<string, string>) => ({
	properties,
	name: "Measurement",
	entitySchemaSlug: "measurement-entry",
	target: {
		kind: "update",
		entityId: entryId,
		expected: {
			name: "Measurement",
			updatedAt: "2026-04-27T08:00:00.000Z",
			properties: { occurredAt: "2026-04-27T08:00:00.000Z" },
		},
	},
});

describe("measurement reading update operation", () => {
	it.live(
		"loads all 205 imported children before editing in one change set",
		() =>
			Effect.gen(function* () {
				const metrics = Array.from({ length: 206 }, (_, index) => ({
					id: `metric-${index}`,
					entitySchemaPluginId: "fitness-owner",
					entitySchemaSlug: "measurement-metric",
				}));
				const children = metrics
					.slice(0, 205)
					.map(({ id }, index) => ({
						entityId: id,
						id: `child-${index}`,
						sessionEntityId: "entry-1",
						properties: { value: index },
						eventSchemaPluginId: "fitness-owner",
						eventSchemaSlug: "measurement-reading",
					}));
				const host = defineSandboxTestHost(manifest, {
					executeRyotql: inMemoryRyotql({
						event: children,
						entity: [...(measurementTables.entity ?? []), ...metrics],
					}),
				});
				const values = [...metrics.slice(0, 204), ...metrics.slice(205)].map(({ id }) => ({
					value: 0,
					metricId: id,
				}));
				const result = yield* runSandboxTestScript(
					updateDefinition,
					{ values, occurredAt, entryId: "entry-1", comment: "After run" },
					host,
					execution,
				);
				expect(result.output).toEqual({ count: 206 });
				const events = result.changes?.events;
				expect(events?.changes.filter(({ kind }) => kind === "update")).toHaveLength(204);
				expect(events?.changes.filter(({ kind }) => kind === "delete")).toEqual<unknown>([
					{ kind: "delete", eventId: "child-204", itemIdentity: "delete:child-204" },
				]);
				expect(events?.creates).toEqual<unknown>([readingCreate("metric-205", 0)]);
				expect(events?.baselines).toEqual<unknown>([{ revision: 0, entityId: "entry-1" }]);
				expect(result.changes?.entity).toEqual<unknown>(
					entryUpdate("entry-1", { occurredAt, comment: "After run" }),
				);
			}),
		testTimeout,
	);

	it.live(
		"updates kept values and time, removes cleared values, and adds new metrics",
		() =>
			Effect.gen(function* () {
				expect(
					yield* runSandboxTestScript(
						updateDefinition,
						{
							occurredAt,
							comment: "Fasted",
							entryId: "entry-1",
							values: [{ value: 0, metricId: "weight" }],
						},
						defaultHost,
						execution,
					),
				).toEqual<unknown>({
					output: { count: 2 },
					changes: {
						entity: entryUpdate("entry-1", { occurredAt, comment: "Fasted" }),
						events: {
							creates: [],
							baselines: [{ revision: 4, entityId: "entry-1" }],
							changes: [
								readingUpdate("reading-1", 0),
								{ kind: "delete", eventId: "reading-2", itemIdentity: "delete:reading-2" },
							],
						},
					},
				});

				expect(
					yield* runSandboxTestScript(
						updateDefinition,
						{
							occurredAt,
							entryId: "entry-2",
							values: [
								{ value: 71, metricId: "weight" },
								{ value: 80, metricId: "waist" },
							],
						},
						defaultHost,
						execution,
					),
				).toEqual<unknown>({
					output: { count: 2 },
					changes: {
						entity: entryUpdate("entry-2", { occurredAt }),
						events: {
							creates: [readingCreate("waist", 80)],
							changes: [readingUpdate("reading-3", 71)],
							baselines: [{ revision: 0, entityId: "entry-2" }],
						},
					},
				});
			}),
		testTimeout,
	);

	it.live(
		"rejects foreign readings or metrics",
		() =>
			Effect.gen(function* () {
				const foreignReading = yield* Effect.flip(
					runSandboxTestScript(
						updateDefinition,
						{ occurredAt, entryId: "fake-reading", values: [{ value: 70, metricId: "weight" }] },
						defaultHost,
						execution,
					),
				);
				expect(foreignReading).toBeInstanceOf(MeasurementEntryNotFoundError);
				const foreignMetric = yield* Effect.flip(
					runSandboxTestScript(
						updateDefinition,
						{
							occurredAt,
							entryId: "entry-1",
							values: [
								{ value: 70, metricId: "weight" },
								{ value: 1, metricId: "exercise-1" },
							],
						},
						defaultHost,
						execution,
					),
				);
				expect(foreignMetric).toBeInstanceOf(MeasurementMetricNotFoundError);
			}),
		testTimeout,
	);
});
