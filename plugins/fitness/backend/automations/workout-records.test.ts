import { automationInputSchema } from "@ryot-app/sandbox-sdk/automation";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { fitnessPlugin } from "../../host/plugin";
import definition, { manifest } from "./workout-records.sandbox";

const timestamp = "2026-01-01T08:00:00.000Z";

const eventSnapshot = (id: string, entityId: string, overrides: Record<string, unknown> = {}) => ({
	id,
	entityId,
	properties: {},
	createdAt: timestamp,
	updatedAt: timestamp,
	occurredAt: timestamp,
	sessionEntityId: "workout-1",
	entitySchemaSlug: "exercise",
	eventSchemaSlug: "workout-set",
	...overrides,
});

const automationInput = (
	items: readonly unknown[],
	eventStreamWorkId?: string,
	source: "api" | "import" = "api",
) =>
	Schema.decodeUnknownSync(automationInputSchema)({
		automation: {
			runId: "run-1",
			occurredAt: timestamp,
			triggerId: "trigger-1",
			executionUserId: "user-1",
			hookSlug: "fitness.workout-records",
			payload: { items, resource: "event", category: "change", operation: "batch" },
			causation: {
				source,
				depth: 0,
				parentRunId: null,
				parentTriggerId: null,
				executionId: "execution-1",
				rootExecutionId: "execution-1",
				initiator: { kind: "user", id: "user-1" },
				...(eventStreamWorkId === undefined ? {} : { eventStreamWorkId }),
			},
		},
	});

const entitySnapshot = {
	name: "Push",
	properties: {},
	id: "workout-1",
	externalId: null,
	providerId: null,
	populatedAt: null,
	createdAt: timestamp,
	updatedAt: timestamp,
	entitySchemaSlug: "workout",
};

const workoutUpdateInput = (changedProperties: readonly string[]) =>
	Schema.decodeSync(automationInputSchema)({
		automation: {
			runId: "run-1",
			occurredAt: timestamp,
			triggerId: "trigger-1",
			executionUserId: "user-1",
			hookSlug: "fitness.workout-context-records",
			payload: {
				changedProperties,
				resource: "entity",
				category: "change",
				operation: "update",
				after: entitySnapshot,
				before: entitySnapshot,
			},
			causation: {
				depth: 0,
				source: "api",
				parentRunId: null,
				parentTriggerId: null,
				executionId: "execution-1",
				rootExecutionId: "execution-1",
				initiator: { kind: "user", id: "user-1" },
			},
		},
	});

const workoutSetExercisePage = (
	entityIds: readonly string[],
	options: { readonly hasMore?: boolean; readonly nextCursor?: string | null } = {},
) => ({
	type: "rows" as const,
	items: entityIds.map((entityId) => ({ entityId })),
	pageInfo: {
		limit: 50,
		hasMore: options.hasMore ?? false,
		nextCursor: options.nextCursor ?? null,
	},
});

const recordingHost = (
	existingExerciseIds = ["exercise-1", "exercise-2", "exercise-3"],
	workoutSetExercisePages?: readonly ReturnType<typeof workoutSetExercisePage>[],
) => {
	const requests: unknown[] = [];
	const workflows: unknown[] = [];
	let pageIndex = 0;
	const host = defineSandboxTestHost(manifest, {
		executeWorkflow: (name, reference, input) =>
			Effect.sync(() => {
				workflows.push({ name, input, reference });
				return undefined;
			}),
		requestEventStreamWork: (request, reference) =>
			Effect.sync(() => {
				requests.push({ request, reference });
				return { workId: `work-${request.entityId}` };
			}),
		executeRyotql: () => {
			if (workoutSetExercisePages !== undefined) {
				const page = workoutSetExercisePages[pageIndex++];
				if (page === undefined) {
					throw new Error("Unexpected workout-set exercise page request");
				}
				return Effect.succeed({ data: { workoutSetExerciseIds: page } });
			}
			return Effect.succeed({
				data: {
					exercises: {
						type: "rows" as const,
						items: existingExerciseIds.map((id) => ({ id })),
						pageInfo: {
							hasMore: false,
							nextCursor: null,
							limit: Math.max(existingExerciseIds.length, 1),
						},
					},
				},
			});
		},
	});
	return { host, requests, workflows };
};

describe("workout start change", () => {
	it("requests record streams for every exercise in the workout when its start changes", () => {
		const { host, requests, workflows } = recordingHost(undefined, [
			workoutSetExercisePage(["exercise-1", "exercise-1", "exercise-2"], {
				hasMore: true,
				nextCursor: "event-cursor",
			}),
			workoutSetExercisePage(["exercise-3"]),
		]);

		return Effect.runPromise(
			definition.run(workoutUpdateInput(["startedAt"]), host).pipe(
				Effect.map((result) => {
					expect(result).toBeNull();
					expect(requests).toEqual(
						["exercise-1", "exercise-2", "exercise-3"].map((entityId) =>
							expect.objectContaining({
								reference: expect.objectContaining({
									referenceKind: "script",
									scriptSlug: "script.workout-record-step",
								}),
								request: {
									entityId,
									eventSchemaSlug: "workout-set",
									outputProperties: ["personalBests", "oneRm", "volume", "pace"],
								},
							}),
						),
					);
					expect(workflows).toEqual(
						["exercise-1", "exercise-2", "exercise-3"].map((entityId) =>
							expect.objectContaining({
								input: { id: `work-${entityId}` },
								name: `workout-start-records:workout-1:${entityId}`,
							}),
						),
					);
				}),
			),
		);
	});

	it("requests nothing when the workout update leaves its start unchanged", () => {
		const { host, requests, workflows } = recordingHost(undefined, []);
		return Effect.runPromise(
			definition.run(workoutUpdateInput([]), host).pipe(
				Effect.map((result) => {
					expect(result).toBeNull();
					expect(requests).toEqual([]);
					expect(workflows).toEqual([]);
				}),
			),
		);
	});
});

describe("workout record automation", () => {
	it("deduplicates before and after exercise streams and dispatches one worker per entity", () => {
		const input = automationInput(
			[
				{
					resource: "event",
					category: "change",
					operation: "update",
					changedProperties: ["weight"],
					after: eventSnapshot("event-1", "exercise-2"),
					before: eventSnapshot("event-1", "exercise-1"),
				},
				{
					resource: "event",
					category: "change",
					operation: "delete",
					before: eventSnapshot("event-2", "exercise-1"),
				},
				{
					resource: "event",
					category: "change",
					operation: "create",
					after: eventSnapshot("event-3", "exercise-3"),
				},
			],
			undefined,
			"import",
		);
		const { host, requests, workflows } = recordingHost();

		return Effect.runPromise(
			definition.run(input, host).pipe(
				Effect.map((result) => {
					expect(result).toBeNull();
					expect(requests).toHaveLength(3);
					expect(requests).toEqual(
						["exercise-1", "exercise-2", "exercise-3"].map((entityId) =>
							expect.objectContaining({
								reference: expect.objectContaining({
									referenceKind: "script",
									scriptSlug: "script.workout-record-step",
								}),
								request: {
									entityId,
									eventSchemaSlug: "workout-set",
									outputProperties: ["personalBests", "oneRm", "volume", "pace"],
								},
							}),
						),
					);
					expect(workflows).toHaveLength(3);
					expect(workflows).toEqual(
						["exercise-1", "exercise-2", "exercise-3"].map((entityId) =>
							expect.objectContaining({
								input: { id: `work-${entityId}` },
								name: `workout-records:${entityId}`,
							}),
						),
					);
				}),
			),
		);
	});

	it("skips only trusted output-only event stream updates and declares the batch hook", () => {
		const before = eventSnapshot("event-1", "exercise-1");
		const after = eventSnapshot("event-1", "exercise-1", {
			properties: { oneRm: 40, personalBests: ["one_rm"] },
		});
		const ownOutput = automationInput(
			[
				{
					after,
					before,
					resource: "event",
					category: "change",
					operation: "update",
					changedProperties: ["oneRm", "personalBests"],
				},
			],
			"stream-work-1",
		);
		const ordinaryOutput = automationInput([
			{
				after,
				before,
				resource: "event",
				category: "change",
				operation: "update",
				changedProperties: ["oneRm", "personalBests"],
			},
		]);
		const markedTimeChange = automationInput(
			[
				{
					before,
					resource: "event",
					category: "change",
					operation: "update",
					changedProperties: ["oneRm"],
					after: eventSnapshot("event-1", "exercise-1", {
						properties: { oneRm: 40 },
						occurredAt: "2026-01-01T09:00:00.000Z",
					}),
				},
			],
			"stream-work-1",
		);
		const { host, requests, workflows } = recordingHost();

		return Effect.runPromise(
			Effect.gen(function* () {
				expect(yield* definition.run(ownOutput, host)).toBeNull();
				expect(requests).toEqual([]);
				expect(yield* definition.run(markedTimeChange, host)).toBeNull();
				expect(requests).toHaveLength(1);
				expect(yield* definition.run(ordinaryOutput, host)).toBeNull();
				expect(requests).toHaveLength(2);
				expect(workflows).toHaveLength(2);
				const hook = fitnessPlugin.hooks.find(({ slug }) => slug === "fitness.workout-records");
				expect(hook).toMatchObject({
					stage: "after",
					delivery: "async",
					batchMaxItems: 50,
					frequency: "batch",
					executionScope: "user",
				});
				expect(hook).not.toHaveProperty("causationSources");
				expect(manifest.inputProjection.event).toEqual({
					properties: [],
					compareProperties: [
						{ equality: "json", property: "confirmedAt" },
						{ equality: "json", property: "distance" },
						{ equality: "json", property: "duration" },
						{ equality: "json", property: "exerciseKind" },
						{ equality: "json", property: "exerciseOrder" },
						{ equality: "json", property: "oneRm" },
						{ property: "pace", equality: "json" },
						{ equality: "json", property: "personalBests" },
						{ property: "reps", equality: "json" },
						{ equality: "json", property: "setOrder" },
						{ equality: "json", property: "volume" },
						{ equality: "json", property: "weight" },
					],
				});
				expect(manifest.inputProjection.entity).toEqual({
					properties: [],
					parentEntityProperties: [],
					compareProperties: [{ equality: "json", property: "startedAt" }],
				});
			}),
		);
	});

	it("skips streams whose exercise entity no longer exists", () => {
		const input = automationInput([
			{
				resource: "event",
				category: "change",
				operation: "delete",
				before: eventSnapshot("event-deleted", "deleted-exercise"),
			},
		]);
		const { host, requests, workflows } = recordingHost([]);

		return Effect.runPromise(
			definition.run(input, host).pipe(
				Effect.map((result) => {
					expect(result).toBeNull();
					expect(requests).toEqual([]);
					expect(workflows).toEqual([]);
				}),
			),
		);
	});

	it("fails before requesting work when workflow dispatch is unavailable", () => {
		const input = automationInput([
			{
				resource: "event",
				category: "change",
				operation: "create",
				after: eventSnapshot("event-1", "exercise-1"),
			},
		]);
		const requests: unknown[] = [];
		const host = defineSandboxTestHost(manifest, {
			requestEventStreamWork: (request) =>
				Effect.sync(() => {
					requests.push(request);
					return { workId: "work-1" };
				}),
		});

		return Effect.runPromise(
			Effect.gen(function* () {
				const error = yield* Effect.flip(definition.run(input, host));
				expect(error).toMatchObject({
					message: "Workout record stream requires workflow dispatch",
				});
				expect(requests).toEqual([]);
			}),
		);
	});
});
