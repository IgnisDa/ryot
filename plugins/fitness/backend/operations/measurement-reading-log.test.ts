import { describe, expect } from "bun:test";

import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import { executeMeasurementRyotql } from "./in-memory-ryotql.test-support";
import logDefinition, { manifest } from "./measurement-reading-log.sandbox";

const execution = { metadata: {}, sandboxScriptId: "script-test" };
const occurredAt = "2026-04-27T08:00:00.000Z";

const host = defineSandboxTestHost(manifest, { executeRyotql: executeMeasurementRyotql });

const log = (input: {
	readonly comment?: string;
	readonly values: readonly { readonly value: number; readonly metricId: string }[];
}) =>
	runSandboxTestScript(
		logDefinition,
		{ ...input, occurredAt, submittedAt: occurredAt, submissionId: "submission-test" },
		host,
		execution,
	);

const reading = (metricId: string, value: number) => ({
	occurredAt,
	kind: "create",
	properties: { value },
	session: { kind: "root" },
	itemIdentity: `reading:${metricId}`,
	eventSchemaSlug: "measurement-reading",
	entity: { kind: "existing", entityId: metricId },
});

describe("measurement reading log operation", () => {
	it.live(
		"records every value, including zero, at one time with the shared comment",
		() =>
			Effect.gen(function* () {
				expect(
					yield* log({
						comment: " After run ",
						values: [
							{ value: 72.4, metricId: "weight" },
							{ value: 0, metricId: "waist" },
						],
					}),
				).toEqual<unknown>({
					output: { count: 2 },
					changes: {
						events: { changes: [reading("weight", 72.4), reading("waist", 0)] },
						entity: {
							name: "Measurement",
							target: { kind: "create" },
							entitySchemaSlug: "measurement-entry",
							properties: { occurredAt, comment: "After run" },
						},
					},
				});
			}),
		testTimeout,
	);

	it.live(
		"omits a blank comment",
		() =>
			Effect.gen(function* () {
				const result = yield* log({ comment: "  ", values: [{ value: 70, metricId: "weight" }] });
				expect(result.changes?.entity?.properties).toEqual({ occurredAt });
			}),
		testTimeout,
	);

	it.live(
		"rejects metrics that are not the caller's measurement metrics and invalid entries",
		() =>
			Effect.gen(function* () {
				for (const metricId of ["missing", "exercise-1"]) {
					const failure = yield* Effect.flip(
						log({
							values: [
								{ value: 70, metricId: "weight" },
								{ metricId, value: 1 },
							],
						}),
					);
					expect(failure).toMatchObject({
						_tag: "OperationRejectedError",
						reason: { key: "rejection.measurement-metric.missing" },
					});
				}
				for (const values of [
					[],
					[{ value: Number.NaN, metricId: "weight" }],
					[
						{ value: 70, metricId: "weight" },
						{ value: 71, metricId: "weight" },
					],
				]) {
					yield* Effect.flip(log({ values }));
				}
				yield* Effect.flip(
					runSandboxTestScript(
						logDefinition,
						{
							occurredAt: "yesterday",
							submittedAt: occurredAt,
							submissionId: "submission-test",
							values: [{ value: 70, metricId: "weight" }],
						},
						host,
						execution,
					),
				);
			}),
		testTimeout,
	);
});
