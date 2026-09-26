import { automationPolicyInputSchema } from "@ryot-app/sandbox-sdk/automation";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import definition, { manifest } from "./workout-set-policy.sandbox";

const timestamp = "2026-01-01T08:00:00.000Z";

const policyInput = (payload: unknown, eventStreamWorkId?: string) =>
	Schema.decodeUnknownSync(automationPolicyInputSchema)({
		automation: {
			payload,
			runId: "run-1",
			occurredAt: timestamp,
			triggerId: "trigger-1",
			executionUserId: "user-1",
			hookSlug: "fitness.workout-set",
			causation: {
				depth: 0,
				source: "api",
				parentRunId: null,
				parentTriggerId: null,
				executionId: "execution-1",
				rootExecutionId: "execution-1",
				initiator: { kind: "user", id: "user-1" },
				...(eventStreamWorkId === undefined ? {} : { eventStreamWorkId }),
			},
		},
	});

const eventDraft = (
	properties: Record<string, unknown>,
	overrides: Record<string, unknown> = {},
) => ({
	properties,
	entityId: "exercise-1",
	sessionEntityId: "workout-1",
	entitySchemaSlug: "exercise",
	eventSchemaSlug: "workout-set",
	occurredAt: "2026-01-01T08:15:00.000Z",
	...overrides,
});

const eventSnapshot = (
	properties: Record<string, unknown>,
	overrides: Record<string, unknown> = {},
) => ({
	...eventDraft(properties, overrides),
	id: "event-1",
	createdAt: timestamp,
	updatedAt: timestamp,
});

const contextResponse = (
	options: { readonly kind?: string | null; readonly startedAt?: string | null } = {},
) => ({
	data: {
		exercise: {
			type: "rows" as const,
			pageInfo: { limit: 2, hasMore: false, nextCursor: null },
			items: [
				{ id: "exercise-1", kind: options.kind === undefined ? "reps_and_weight" : options.kind },
			],
		},
		workout: {
			type: "rows" as const,
			pageInfo: { limit: 2, hasMore: false, nextCursor: null },
			items: [
				{
					id: "workout-1",
					startedAt: options.startedAt === undefined ? timestamp : options.startedAt,
				},
			],
		},
	},
});

const run = (
	input: ReturnType<typeof policyInput>,
	context = contextResponse(),
	calls: unknown[] = [],
) =>
	definition.run(
		input,
		defineSandboxTestHost(manifest, {
			executeRyotql: (document) => {
				calls.push(document);
				return Effect.succeed(context);
			},
		}),
	);

describe("workout set policy", () => {
	it("derives statistics from metric measurements and removes supplied badges", () => {
		const input = policyInput({
			resource: "event",
			category: "request",
			operation: "create",
			draft: eventDraft({
				pace: 8,
				reps: 10,
				weight: 10,
				oneRm: 900,
				volume: 900,
				restTime: 90,
				distance: 2.5,
				note: "Keep this note",
				personalBests: ["time"],
			}),
		});

		return Effect.runPromise(
			run(input).pipe(
				Effect.map((result) => {
					expect(result).toEqual({
						action: "transform",
						patch: {
							resource: "event",
							draft: {
								properties: {
									remove: ["pace", "personalBests"],
									set: { volume: 100, oneRm: 13.333333, exerciseKind: "reps_and_weight" },
								},
							},
						},
					});
				}),
			),
		);
	});

	it("keeps zero measurements and does not change notes or rest fields", () => {
		const input = policyInput({
			resource: "event",
			category: "request",
			operation: "create",
			draft: eventDraft({ reps: 0, weight: 0, restTime: 0, note: "Keep this" }),
		});

		return Effect.runPromise(
			run(input).pipe(
				Effect.map((result) => {
					expect(result).toEqual({
						action: "transform",
						patch: {
							resource: "event",
							draft: { properties: { remove: [], set: { exerciseKind: "reps_and_weight" } } },
						},
					});
				}),
			),
		);
	});

	it("corrects ordinary output edits but preserves trusted worker badges", () => {
		const before = eventSnapshot({
			reps: 8,
			weight: 20,
			volume: 160,
			oneRm: 24.827586,
			personalBests: ["reps", "one_rm"],
		});
		const ordinary = policyInput({
			before,
			resource: "event",
			category: "request",
			operation: "update",
			changedProperties: ["oneRm"],
			draft: eventDraft({
				reps: 8,
				weight: 20,
				oneRm: 400,
				volume: 160,
				personalBests: ["reps", "one_rm"],
			}),
		});
		const worker = policyInput(
			{
				before,
				resource: "event",
				category: "request",
				operation: "update",
				changedProperties: ["oneRm", "personalBests"],
				draft: eventDraft({
					reps: 8,
					weight: 20,
					volume: 160,
					oneRm: 24.827586,
					personalBests: ["reps", "one_rm"],
				}),
			},
			"stream-work-1",
		);
		const calls: unknown[] = [];

		return Effect.runPromise(
			Effect.gen(function* () {
				const corrected = yield* run(ordinary, contextResponse(), calls);
				const preserved = yield* run(worker, contextResponse(), calls);
				expect(corrected).toEqual({
					action: "transform",
					patch: {
						resource: "event",
						draft: {
							properties: {
								remove: ["personalBests"],
								set: { oneRm: 24.827586, exerciseKind: "reps_and_weight" },
							},
						},
					},
				});
				expect(preserved).toEqual({ action: "allow" });
				expect(calls).toHaveLength(1);
			}),
		);
	});

	it("keeps a recorded kind that differs from the exercise and rejects an unknown one", () => {
		const recorded = policyInput({
			resource: "event",
			category: "request",
			operation: "create",
			draft: eventDraft({ reps: 12, oneRm: 28, weight: 20, volume: 240, exerciseKind: "reps" }),
		});
		const unknown = policyInput({
			resource: "event",
			category: "request",
			operation: "create",
			draft: eventDraft({ reps: 12, exerciseKind: "sprints" }),
		});

		return Effect.runPromise(
			Effect.gen(function* () {
				expect(yield* run(recorded, contextResponse({ kind: "reps_and_weight" }))).toEqual({
					action: "transform",
					patch: {
						resource: "event",
						draft: { properties: { set: {}, remove: ["oneRm", "volume"] } },
					},
				});
				expect(yield* run(unknown)).toEqual({
					action: "reject",
					reason: "workout_set_exercise_kind_invalid",
				});
			}),
		);
	});

	it("rejects a workout set without a complete exercise and workout context", () => {
		const input = policyInput({
			resource: "event",
			category: "request",
			operation: "create",
			draft: eventDraft({ reps: 5 }),
		});

		return Effect.runPromise(
			run(input, contextResponse({ kind: null, startedAt: null })).pipe(
				Effect.map((result) => {
					expect(result).toEqual({ action: "reject", reason: "workout_set_context_missing" });
				}),
			),
		);
	});
});
