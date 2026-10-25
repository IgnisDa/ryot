import { expect, it } from "@effect/vitest";
import { automationPolicyInputSchema } from "@ryot-app/plugin-backend-sdk/automation";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";

import definition, { manifest } from "./workout-exercise-policy.sandbox";

const now = "2026-10-01T10:00:00.000Z";
const properties = {
	targets: [],
	equipment: [],
	exerciseOrder: 0,
	exerciseKind: "reps",
	provenance: "recorded",
};
const input = (operation: "create" | "update", changes: Record<string, unknown> = {}) => {
	const draft = {
		occurredAt: now,
		entityId: "exercise",
		sessionEntityId: "workout",
		entitySchemaSlug: "exercise",
		eventSchemaPluginId: "fitness",
		entitySchemaPluginId: "fitness",
		eventSchemaSlug: "workout-exercise",
		properties: { ...properties, ...changes },
	};
	return Schema.decodeUnknownEffect(automationPolicyInputSchema)({
		automation: {
			runId: "run",
			occurredAt: now,
			triggerId: "trigger",
			executionUserId: "user",
			hookSlug: "fitness.workout-exercise",
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
			references: {
				workout: {
					entitySchemaSlug: "workout",
					properties: { startedAt: now },
					entitySchemaPluginId: "fitness",
				},
				exercise: {
					entitySchemaSlug: "exercise",
					properties: { kind: "reps" },
					entitySchemaPluginId: "fitness",
				},
			},
			payload: {
				draft,
				operation,
				resource: "event",
				category: "request",
				...(operation === "update"
					? {
							changedProperties: Object.keys(changes),
							before: { ...draft, properties, createdAt: now, updatedAt: now, id: "occurrence" },
						}
					: {}),
			},
		},
	}).pipe(
		Effect.orDie,
		Effect.map(({ automation: { payload, ...automation } }) => ({
			automation,
			items: [{ payload, itemIdentity: "occurrence" }],
		})),
	);
};

const host = (hasMore = false) =>
	defineSandboxTestHost(manifest, {
		executeRyotql: (document) =>
			Effect.succeed({
				data: Object.fromEntries(
					Object.keys(document.queries).map((key) => [
						key,
						{
							type: "rows",
							pageInfo: { hasMore, limit: 100, nextCursor: hasMore ? "more" : null },
							items:
								key === "targets"
									? [
											{
												id: "chest",
												userId: null,
												name: "Chest",
												kind: "muscle",
												role: "secondary",
												relationshipId: "target-link",
											},
										]
									: [
											{
												userId: null,
												id: "barbell",
												name: "Barbell",
												relationshipId: "equipment-link",
											},
										],
						},
					]),
				),
			}),
	});

it.effect("captures identities and roles once per occurrence", () =>
	Effect.gen(function* () {
		const result = yield* definition.run(
			yield* input("create", { exerciseKind: "duration" }),
			host(),
		);
		expect(result.items[0]?.decision).toEqual({
			action: "transform",
			patch: {
				resource: "event",
				draft: {
					properties: {
						remove: [],
						set: {
							exerciseKind: "reps",
							provenance: "recorded",
							equipment: ["barbell"],
							targets: [{ entityId: "chest", role: "secondary" }],
						},
					},
				},
			},
		});
	}),
);

it.effect("allows occurrence updates without reading taxonomy", () =>
	Effect.gen(function* () {
		expect(
			(yield* definition.run(
				yield* input("update", { exerciseOrder: 2 }),
				defineSandboxTestHost(manifest, {}),
			)).items[0]?.decision,
		).toEqual({ action: "allow" });
	}),
);

it.effect("fails closed instead of truncating taxonomy", () =>
	Effect.gen(function* () {
		expect((yield* definition.run(yield* input("create"), host(true))).items[0]?.decision).toEqual({
			action: "reject",
			reason: "workout_taxonomy_capacity",
		});
	}),
);
