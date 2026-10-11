import { describe, expect, it } from "@effect/vitest";
import type { CreateEventItem } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";

import logDefinition, { manifest } from "./measurement-reading-log.sandbox";
import { MeasurementMetricNotFoundError } from "./measurement-readings";
import { executeMeasurementRyotql } from "./measurement-readings.test-support";

const execution = { metadata: {}, sandboxScriptId: "script-test" };
const occurredAt = "2026-04-27T08:00:00.000Z";

const recordingHost = (creates: (readonly CreateEventItem[])[]) =>
	defineSandboxTestHost(manifest, {
		executeRyotql: executeMeasurementRyotql,
		createEvents: (items) =>
			Effect.sync(() => {
				creates.push(items);
				return { count: items.length };
			}),
	});

describe("measurement reading log operation", () => {
	it.live("records every value, including zero, at one time with the shared comment", () =>
		Effect.gen(function* () {
			const creates: (readonly CreateEventItem[])[] = [];

			expect(
				yield* runSandboxTestScript(
					logDefinition,
					{
						occurredAt,
						comment: " After run ",
						values: [
							{ value: 72.4, metricId: "weight" },
							{ value: 0, metricId: "waist" },
						],
					},
					recordingHost(creates),
					execution,
				),
			).toEqual({ count: 2 });
			expect(creates).toEqual([
				[
					{
						occurredAt,
						entityId: "weight",
						eventSchemaSlug: "measurement-reading",
						properties: { value: 72.4, comment: "After run" },
					},
					{
						occurredAt,
						entityId: "waist",
						eventSchemaSlug: "measurement-reading",
						properties: { value: 0, comment: "After run" },
					},
				],
			]);
		}),
	);

	it.live("omits a blank comment", () =>
		Effect.gen(function* () {
			const creates: (readonly CreateEventItem[])[] = [];

			yield* runSandboxTestScript(
				logDefinition,
				{ occurredAt, comment: "  ", values: [{ value: 70, metricId: "weight" }] },
				recordingHost(creates),
				execution,
			);
			expect(creates[0]?.[0]?.properties).toEqual({ value: 70 });
		}),
	);

	it.live("rejects metrics that are not the caller's measurement metrics without writing", () =>
		Effect.gen(function* () {
			const creates: (readonly CreateEventItem[])[] = [];
			const host = recordingHost(creates);

			for (const metricId of ["missing", "exercise-1"]) {
				const failure = yield* Effect.flip(
					runSandboxTestScript(
						logDefinition,
						{
							occurredAt,
							values: [
								{ value: 70, metricId: "weight" },
								{ metricId, value: 1 },
							],
						},
						host,
						execution,
					),
				);
				expect(failure).toBeInstanceOf(MeasurementMetricNotFoundError);
			}
			for (const input of [
				{ occurredAt, values: [] },
				{ occurredAt: "yesterday", values: [{ value: 70, metricId: "weight" }] },
				{ occurredAt, values: [{ value: Number.NaN, metricId: "weight" }] },
				{
					occurredAt,
					values: [
						{ value: 70, metricId: "weight" },
						{ value: 71, metricId: "weight" },
					],
				},
			]) {
				yield* Effect.flip(runSandboxTestScript(logDefinition, input, host, execution));
			}

			expect(creates).toEqual([]);
		}),
	);
});
