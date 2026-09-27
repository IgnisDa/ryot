import { automationPolicyInputSchema } from "@ryot-app/sandbox-sdk/automation";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import definition, { manifest } from "./workout-context-policy.sandbox";

const timestamp = "2026-01-01T08:00:00.000Z";

const policyInput = (payload: unknown, executionUserId: string | null = "user-1") =>
	Schema.decodeUnknownSync(automationPolicyInputSchema)({
		automation: {
			payload,
			runId: "run-1",
			executionUserId,
			occurredAt: timestamp,
			triggerId: "trigger-1",
			hookSlug: "fitness.workout-context",
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

const eventDraft = (
	properties: Record<string, unknown>,
	overrides: Record<string, unknown> = {},
) => ({
	properties,
	entityId: "exercise-1",
	sessionEntityId: "workout-1",
	entitySchemaSlug: "exercise",
	eventSchemaSlug: "workout-set",
	occurredAt: "2026-01-01T09:00:00.000Z",
	...overrides,
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

const entityUpdate = (
	entitySchemaSlug: "exercise" | "workout",
	property: "kind" | "startedAt",
	value?: unknown,
	dependentEvents: ReadonlyArray<Record<string, unknown>> = [],
) => ({
	dependentEvents,
	resource: "entity",
	category: "request",
	operation: "update",
	changedProperties: [property],
	draft: {
		name: "Entity",
		entitySchemaSlug,
		externalId: null,
		providerId: null,
		populatedAt: null,
		properties: value === undefined ? {} : { [property]: value },
	},
	before: {
		id: "entity-1",
		name: "Entity",
		entitySchemaSlug,
		externalId: null,
		providerId: null,
		populatedAt: null,
		createdAt: timestamp,
		updatedAt: timestamp,
		properties: { [property]: property === "kind" ? "reps_and_weight" : timestamp },
	},
});

const run = (input: ReturnType<typeof policyInput>, response: unknown, calls: unknown[] = []) =>
	definition.run(
		input,
		defineSandboxTestHost(manifest, {
			executeRyotql: (document) => {
				calls.push(document);
				return Effect.succeed(response);
			},
		}),
	);

const invalidContextCases: ReadonlyArray<
	readonly ["exercise" | "workout", "kind" | "startedAt", string, "entity" | "session"]
> = [
	["exercise", "kind", "exercise_kind_has_workout_sets", "entity"],
	["workout", "startedAt", "workout_start_has_workout_sets", "session"],
];

describe("workout context policy", () => {
	it("sets unconfirmed event time to the session start without changing other properties", () => {
		const input = policyInput({
			resource: "event",
			category: "request",
			operation: "create",
			draft: eventDraft({ restTime: 90, note: "Keep note" }),
		});

		return Effect.runPromise(
			run(input, contextResponse()).pipe(
				Effect.map((result) => {
					expect(result).toEqual({
						action: "transform",
						patch: { resource: "event", draft: { occurredAt: timestamp } },
					});
				}),
			),
		);
	});

	it("uses a confirmed time and rejects missing event context", () => {
		const confirmed = policyInput({
			resource: "event",
			category: "request",
			operation: "create",
			draft: eventDraft({ confirmedAt: "2026-01-01T08:45:00.000Z" }),
		});
		const missingKind = policyInput({
			resource: "event",
			category: "request",
			operation: "create",
			draft: eventDraft({}),
		});
		const missingStart = policyInput({
			resource: "event",
			category: "request",
			operation: "create",
			draft: eventDraft({}),
		});
		const missingSession = policyInput({
			resource: "event",
			category: "request",
			operation: "create",
			draft: eventDraft({}, { sessionEntityId: null }),
		});

		return Effect.runPromise(
			Effect.gen(function* () {
				expect(yield* run(confirmed, contextResponse())).toEqual({
					action: "transform",
					patch: { resource: "event", draft: { occurredAt: "2026-01-01T08:45:00.000Z" } },
				});
				expect(yield* run(missingKind, contextResponse({ kind: null }))).toEqual({
					action: "reject",
					reason: "workout_set_context_missing",
				});
				expect(yield* run(missingStart, contextResponse({ startedAt: null }))).toEqual({
					action: "reject",
					reason: "workout_set_context_missing",
				});
				expect(yield* run(missingSession, contextResponse())).toEqual({
					action: "reject",
					reason: "workout_set_context_missing",
				});
			}),
		);
	});

	it.each(invalidContextCases)(
		"rejects invalid %s context when dependent sets reference its %s role",
		(entitySchemaSlug, property, reason, role) => {
			const dependencies = [{ role, eventSchemaPluginId: null, eventSchemaSlug: "workout-set" }];
			const value = entitySchemaSlug === "exercise" ? "invalid-kind" : "not-a-date";
			const input = policyInput(entityUpdate(entitySchemaSlug, property, value, dependencies));
			const calls: unknown[] = [];

			return Effect.runPromise(
				Effect.gen(function* () {
					expect(yield* run(input, undefined, calls)).toEqual({ reason, action: "reject" });
					expect(calls).toEqual([]);
				}),
			);
		},
	);

	it.each(invalidContextCases)(
		"rejects removing %s context when dependent sets reference its %s role",
		(entitySchemaSlug, property, reason, role) => {
			const input = policyInput(
				entityUpdate(entitySchemaSlug, property, undefined, [
					{ role, eventSchemaPluginId: null, eventSchemaSlug: "workout-set" },
				]),
			);
			return Effect.runPromise(
				Effect.map(run(input, undefined), (result) =>
					expect(result).toEqual({ reason, action: "reject" }),
				),
			);
		},
	);

	it("allows missing or invalid context when no matching workout-set dependency exists", () => {
		const userInput = policyInput(entityUpdate("exercise", "kind"));
		const globalInput = policyInput(
			entityUpdate("workout", "startedAt", null, [
				{ role: "entity", eventSchemaPluginId: null, eventSchemaSlug: "workout-set" },
			]),
			null,
		);
		const calls: unknown[] = [];

		return Effect.runPromise(
			Effect.gen(function* () {
				expect(yield* run(userInput, undefined, calls)).toEqual({ action: "allow" });
				expect(yield* run(globalInput, undefined, calls)).toEqual({ action: "allow" });
				expect(calls).toEqual([]);
			}),
		);
	});

	it("allows valid required context changes for user and global entities with dependent sets", () => {
		const exerciseDependencies = [
			{ role: "entity", eventSchemaPluginId: null, eventSchemaSlug: "workout-set" },
		];
		const workoutDependencies = [
			{ role: "session", eventSchemaPluginId: null, eventSchemaSlug: "workout-set" },
		];
		const userInput = policyInput(
			entityUpdate("exercise", "kind", "duration", exerciseDependencies),
		);
		const globalInput = policyInput(
			entityUpdate("workout", "startedAt", "2026-01-01T09:00:00.000Z", workoutDependencies),
			null,
		);
		const calls: unknown[] = [];

		return Effect.runPromise(
			Effect.gen(function* () {
				expect(yield* run(userInput, undefined, calls)).toEqual({ action: "allow" });
				expect(yield* run(globalInput, undefined, calls)).toEqual({ action: "allow" });
				expect(calls).toEqual([]);
			}),
		);
	});
});
