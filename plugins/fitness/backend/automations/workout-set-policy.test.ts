import { expect, it } from "@effect/vitest";
import { automationPolicyInputSchema } from "@ryot-app/plugin-backend-sdk/automation";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import definition from "./workout-set-policy.sandbox";

const now = "2026-06-02T10:00:00.000Z";
const references = {
	workout: {
		entitySchemaSlug: "workout",
		properties: { startedAt: now },
		entitySchemaPluginId: "fitness",
	},
	exercise: {
		entitySchemaSlug: "exercise",
		entitySchemaPluginId: "fitness",
		properties: { kind: "reps_and_weight" },
	},
};
const input = (
	properties: Record<string, unknown>,
	options: {
		operation?: "create" | "update" | "delete";
		sessionEntityId?: string | null;
		entitySchemaSlug?: string;
		references?: Record<string, unknown>;
	} = {},
) => {
	const draft = {
		properties,
		occurredAt: now,
		entityId: "exercise",
		eventSchemaSlug: "workout-set",
		eventSchemaPluginId: "fitness",
		entitySchemaPluginId: "fitness",
		entitySchemaSlug: options.entitySchemaSlug ?? "exercise",
		sessionEntityId: options.sessionEntityId === undefined ? "workout" : options.sessionEntityId,
	};
	const snapshot = { ...draft, id: "event", createdAt: now, updatedAt: now };
	return Schema.decodeUnknownSync(automationPolicyInputSchema)({
		automation: {
			runId: "run",
			occurredAt: now,
			triggerId: "trigger",
			executionUserId: "user",
			hookSlug: "fitness.workout-set",
			references: options.references ?? references,
			causation: {
				depth: 0,
				source: "api",
				parentRunId: null,
				lane: "interactive",
				parentTriggerId: null,
				executionId: "execution",
				rootExecutionId: "execution",
				initiator: { id: "user", kind: "user" },
			},
			payload: {
				resource: "event",
				category: "request",
				operation: options.operation ?? "create",
				draft: options.operation === "delete" ? snapshot : draft,
				...(options.operation === "update"
					? { before: snapshot, changedProperties: ["reps"] }
					: {}),
			},
		},
	});
};
type BatchItem = { readonly itemIdentity: string; readonly policyInput: ReturnType<typeof input> };
const batch = (first: BatchItem, ...rest: BatchItem[]) => {
	const { payload: firstPayload, ...automation } = first.policyInput.automation;
	return {
		automation,
		items: [
			{ payload: firstPayload, itemIdentity: first.itemIdentity },
			...rest.map(({ policyInput, itemIdentity }) => ({
				itemIdentity,
				payload: policyInput.automation.payload,
			})),
		],
	};
};
const run = (properties: Record<string, unknown>, options?: Parameters<typeof input>[1]) =>
	definition
		.run(batch({ itemIdentity: "set", policyInput: input(properties, options) }))
		.pipe(Effect.map(({ items }) => items[0]?.decision));

it.effect("records the exercise kind without writing computed fields", () =>
	Effect.gen(function* () {
		expect(yield* run({ reps: 10, weight: 20 })).toEqual({
			action: "transform",
			patch: {
				resource: "event",
				draft: { properties: { remove: [], set: { exerciseKind: "reps_and_weight" } } },
			},
		});
	}),
);

it.effect("keeps each set's recorded kind instead of replacing it from the exercise", () =>
	Effect.gen(function* () {
		expect(yield* run({ reps: 0, exerciseKind: "reps" })).toEqual({ action: "allow" });
		expect(
			yield* run(
				{ reps: 12, weight: 20, exerciseKind: "reps_and_weight" },
				{ operation: "update" },
			),
		).toEqual({ action: "allow" });
	}),
);

it.effect("uses confirmation time for event ordering without requiring it", () =>
	Effect.gen(function* () {
		const confirmedAt = "2026-06-02T10:05:00.000Z";
		expect(yield* run({ reps: 10, confirmedAt, exerciseKind: "reps" })).toEqual({
			action: "transform",
			patch: { resource: "event", draft: { occurredAt: confirmedAt } },
		});
		expect(yield* run({ reps: 10, confirmedAt: now, exerciseKind: "reps" })).toEqual({
			action: "allow",
		});
		expect(yield* run({ reps: 10, exerciseKind: "reps" })).toEqual({ action: "allow" });
		expect(yield* run({ reps: 10, confirmedAt: "invalid" })).toEqual({
			action: "reject",
			reason: "workout_set_confirmed_at_invalid",
		});
	}),
);

it.effect("rejects missing, malformed, or foreign workout context", () =>
	Effect.gen(function* () {
		for (const options of [
			{ sessionEntityId: null },
			{ references: {} },
			{
				references: {
					...references,
					workout: { ...references.workout, entitySchemaPluginId: "foreign" },
				},
			},
			{
				references: {
					...references,
					exercise: { ...references.exercise, entitySchemaPluginId: "foreign" },
				},
			},
			{
				references: {
					...references,
					workout: { ...references.workout, properties: { startedAt: "invalid" } },
				},
			},
		]) {
			expect(yield* run({ reps: 10 }, options)).toEqual({
				action: "reject",
				reason: "workout_set_context_missing",
			});
		}
	}),
);

it.effect("rejects unsupported recorded kinds and invalid measurements", () =>
	Effect.gen(function* () {
		expect(yield* run({ reps: 10, exerciseKind: "invalid" })).toEqual({
			action: "reject",
			reason: "workout_set_exercise_kind_invalid",
		});
		expect(yield* run({ reps: "invalid" })).toEqual({
			action: "reject",
			reason: "workout_set_measurements_invalid",
		});
	}),
);

it.effect("does not apply create/update rules to deletions or other entity schemas", () =>
	Effect.gen(function* () {
		expect(yield* run({}, { references: {}, operation: "delete" })).toEqual({ action: "allow" });
		expect(yield* run({}, { references: {}, entitySchemaSlug: "other" })).toEqual({
			action: "allow",
		});
	}),
);

it.effect("retains independent decisions and identities throughout a batch", () =>
	Effect.gen(function* () {
		const result = yield* definition.run(
			batch(
				{ itemIdentity: "missing", policyInput: input({ reps: 10 }, { sessionEntityId: null }) },
				{ itemIdentity: "valid", policyInput: input({ reps: 0, exerciseKind: "reps" }) },
			),
		);
		expect(result.items).toEqual([
			{
				itemIdentity: "missing",
				decision: { action: "reject", reason: "workout_set_context_missing" },
			},
			{ itemIdentity: "valid", decision: { action: "allow" } },
		]);
	}),
);
