import { describe, expect, it } from "@effect/vitest";
import { EventId } from "@ryot-app/contract/schema/brands";
import type {
	CreateEventItem,
	DomainSandboxHostMethodMap,
} from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";

import { executeMeasurementRyotql } from "./in-memory-ryotql.test-support";
import logDefinition, { manifest } from "./measurement-reading-log.sandbox";
import { MeasurementMetricNotFoundError } from "./measurement-readings";

const execution = { metadata: {}, sandboxScriptId: "script-test" };
const occurredAt = "2026-04-27T08:00:00.000Z";
type CreateEventOptions = NonNullable<Parameters<DomainSandboxHostMethodMap["createEvents"]>[1]>;

const recordingHost = (
	creates: (readonly CreateEventItem[])[],
	createOptions: (undefined | CreateEventOptions)[],
) =>
	defineSandboxTestHost(manifest, {
		executeRyotql: executeMeasurementRyotql,
		createUserEntity: () => Effect.succeed({ entityId: "entry-test" }),
		createEvents: (items, options) =>
			Effect.sync(() => {
				creates.push(items);
				createOptions.push(options);
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
	it.live("does not report completion when a policy skips a reading", () =>
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
	);

	it.live(
		"reports a partial commit without claiming completion and retries with the same write identity",
		() =>
			Effect.gen(function* () {
				const options: (undefined | CreateEventOptions)[] = [];
				const entries: unknown[] = [];
				const host = defineSandboxTestHost(manifest, {
					executeRyotql: executeMeasurementRyotql,
					createUserEntity: (item, identity) =>
						Effect.sync(() => {
							entries.push({ item, identity });
							return { entityId: "entry-test" };
						}),
					createEvents: (items, identity) =>
						Effect.suspend(() => {
							options.push(identity);
							return options.length === 1
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
				expect(options).toEqual([
					{ submittedAt: occurredAt, idempotencyKey: "partial-submission" },
					{ submittedAt: occurredAt, idempotencyKey: "partial-submission" },
				]);
				expect(entries).toEqual(
					Array.from({ length: 2 }, () => ({
						identity: { submittedAt: occurredAt, idempotencyKey: "partial-submission:entry" },
						item: {
							name: "Measurement",
							properties: { occurredAt },
							entitySchemaSlug: "measurement-entry",
						},
					})),
				);
			}),
	);

	it.live("records every value, including zero, at one time with the shared comment", () =>
		Effect.gen(function* () {
			const creates: (readonly CreateEventItem[])[] = [];
			const createOptions: (undefined | CreateEventOptions)[] = [];

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
					recordingHost(creates, createOptions),
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
			expect(createOptions).toEqual([
				{ submittedAt: occurredAt, idempotencyKey: "submission-test" },
			]);
		}),
	);

	it.live("omits a blank comment", () =>
		Effect.gen(function* () {
			const creates: (readonly CreateEventItem[])[] = [];
			const createOptions: (undefined | CreateEventOptions)[] = [];

			yield* runSandboxTestScript(
				logDefinition,
				{
					occurredAt,
					comment: "  ",
					submittedAt: occurredAt,
					submissionId: "submission-test",
					values: [{ value: 70, metricId: "weight" }],
				},
				recordingHost(creates, createOptions),
				execution,
			);
			expect(creates[0]?.[0]?.properties).toEqual({ value: 70 });
			expect(createOptions).toEqual([
				{ submittedAt: occurredAt, idempotencyKey: "submission-test" },
			]);
		}),
	);

	it.live("rejects metrics that are not the caller's measurement metrics without writing", () =>
		Effect.gen(function* () {
			const creates: (readonly CreateEventItem[])[] = [];
			const createOptions: (undefined | CreateEventOptions)[] = [];
			const host = recordingHost(creates, createOptions);

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
			expect(createOptions).toEqual([]);
		}),
	);
});
