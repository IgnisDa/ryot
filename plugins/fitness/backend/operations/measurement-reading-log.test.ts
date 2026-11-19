import { describe, expect } from "bun:test";

import { EventId } from "@ryot-app/contract/schema/brands";
import type { CreateEventItem } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import { executeMeasurementRyotql } from "./in-memory-ryotql.test-support";
import logDefinition, { manifest } from "./measurement-reading-log.sandbox";
import { MeasurementMetricNotFoundError } from "./measurement-readings";

const execution = { metadata: {}, sandboxScriptId: "script-test" };
const occurredAt = "2026-04-27T08:00:00.000Z";

const recordingHost = (creates: (readonly CreateEventItem[])[]) =>
	defineSandboxTestHost(manifest, {
		executeRyotql: executeMeasurementRyotql,
		createUserEntity: () => Effect.succeed({ entityId: "entry-test" }),
		createEvents: (items) =>
			Effect.sync(() => {
				creates.push(items);
				return {
					count: items.length,
					outcomes: items.map((_, index) => ({
						index,
						status: "written" as const,
						eventId: EventId.make(`created-event-${index}`),
					})),
				};
			}),
	});

describe("measurement reading log operation", () => {
	it.live(
		"does not report completion when a policy skips a reading",
		() =>
			Effect.gen(function* () {
				const host = defineSandboxTestHost(manifest, {
					executeRyotql: executeMeasurementRyotql,
					createEvents: () => Effect.succeed({ count: 0, outcomes: [] }),
					createUserEntity: () => Effect.succeed({ entityId: "entry-test" }),
				});
				expect(
					yield* runSandboxTestScript(
						logDefinition,
						{
							occurredAt,
							submittedAt: occurredAt,
							submissionId: "skipped",
							values: [{ value: 0, metricId: "weight" }],
						},
						host,
						execution,
					),
				).toEqual({ count: 0, status: "incomplete" });
			}),
		testTimeout,
	);

	it.live(
		"reports a partial commit without claiming completion and retries with the same write identity",
		() =>
			Effect.gen(function* () {
				let creates = 0;
				const entries: unknown[] = [];
				const host = defineSandboxTestHost(manifest, {
					executeRyotql: executeMeasurementRyotql,
					createUserEntity: (item) =>
						Effect.sync(() => {
							entries.push(item);
							return { entityId: "entry-test" };
						}),
					createEvents: (items) =>
						Effect.suspend(() => {
							creates += 1;
							return creates === 1
								? Effect.fail({
										message: "Event creation failed",
										data: {
											count: 1,
											partial: true,
											outcomes: [
												{ index: 0, status: "written", eventId: EventId.make("created-event-0") },
											],
										},
									})
								: Effect.succeed({
										count: items.length,
										outcomes: items.map((_, index) => ({
											index,
											status: "written" as const,
											eventId: EventId.make(`created-event-${index}`),
										})),
									});
						}),
				});
				const input = {
					occurredAt,
					submittedAt: occurredAt,
					submissionId: "partial-submission",
					values: [
						{ value: 0, metricId: "weight" },
						{ value: 80, metricId: "waist" },
					],
				};
				expect(yield* runSandboxTestScript(logDefinition, input, host, execution)).toEqual({
					count: 1,
					status: "incomplete",
				});
				expect(yield* runSandboxTestScript(logDefinition, input, host, execution)).toEqual({
					count: 2,
					status: "saved",
				});
				expect(entries).toEqual(
					Array.from({ length: 2 }, () => ({
						name: "Measurement",
						properties: { occurredAt },
						entitySchemaSlug: "measurement-entry",
					})),
				);
			}),
		testTimeout,
	);

	it.live(
		"records every value, including zero, at one time with the shared comment",
		() =>
			Effect.gen(function* () {
				const creates: (readonly CreateEventItem[])[] = [];

				expect(
					yield* runSandboxTestScript(
						logDefinition,
						{
							occurredAt,
							comment: " After run ",
							submittedAt: occurredAt,
							submissionId: "submission-test",
							values: [
								{ value: 72.4, metricId: "weight" },
								{ value: 0, metricId: "waist" },
							],
						},
						recordingHost(creates),
						execution,
					),
				).toEqual({ count: 2, status: "saved" });
				expect(creates).toEqual([
					[
						{
							occurredAt,
							entityId: "weight",
							properties: { value: 72.4 },
							sessionEntityId: "entry-test",
							eventSchemaSlug: "measurement-reading",
						},
						{
							occurredAt,
							entityId: "waist",
							properties: { value: 0 },
							sessionEntityId: "entry-test",
							eventSchemaSlug: "measurement-reading",
						},
					],
				]);
			}),
		testTimeout,
	);

	it.live(
		"omits a blank comment",
		() =>
			Effect.gen(function* () {
				const creates: (readonly CreateEventItem[])[] = [];

				yield* runSandboxTestScript(
					logDefinition,
					{
						occurredAt,
						comment: "  ",
						submittedAt: occurredAt,
						submissionId: "submission-test",
						values: [{ value: 70, metricId: "weight" }],
					},
					recordingHost(creates),
					execution,
				);
				expect(creates[0]?.[0]?.properties).toEqual({ value: 70 });
			}),
		testTimeout,
	);

	it.live(
		"rejects metrics that are not the caller's measurement metrics without writing",
		() =>
			Effect.gen(function* () {
				const creates: (readonly CreateEventItem[])[] = [];
				const host = recordingHost(creates);

				for (const metricId of ["missing", "exercise-1"]) {
					const failure = yield* Effect.flip(
						runSandboxTestScript(
							logDefinition,
							{
								occurredAt,
								submittedAt: occurredAt,
								submissionId: "submission-test",
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
					{ occurredAt, values: [], submittedAt: occurredAt, submissionId: "submission-test" },
					{
						occurredAt: "yesterday",
						submittedAt: occurredAt,
						submissionId: "submission-test",
						values: [{ value: 70, metricId: "weight" }],
					},
					{
						occurredAt,
						submittedAt: occurredAt,
						submissionId: "submission-test",
						values: [{ value: Number.NaN, metricId: "weight" }],
					},
					{
						occurredAt,
						submittedAt: occurredAt,
						submissionId: "submission-test",
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
		testTimeout,
	);
});
