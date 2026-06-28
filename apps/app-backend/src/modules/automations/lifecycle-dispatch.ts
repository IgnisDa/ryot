import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { DbError, unknownToMessage } from "@ryot/contract/errors";
import { AutomationProperties } from "@ryot/contract/modules/automations/schemas";
import { Effect, Either, Layer, Match, Schema } from "effect";

import {
	LifecycleDispatch,
	type LifecycleDispatchInput,
	type LifecycleSource,
} from "#modules/entities/lifecycle-dispatch";

import type { AutomationRuleTarget } from "./repository";
import { AutomationsService } from "./service";
import { SubscriptionExecutionWorkflow } from "./subscription-execution-workflow";

const decodeProperties = Schema.decodeUnknown(AutomationProperties);

const sourceSnapshot = <A>(source: { after?: A; before?: A }): A => {
	const snapshot = source.after ?? source.before;
	if (!snapshot) {
		throw new Error("Lifecycle source requires a before or after snapshot");
	}
	return snapshot;
};

const targetForSource = (source: LifecycleSource): AutomationRuleTarget =>
	Match.value(source).pipe(
		Match.when({ kind: "entity" }, (value) => ({
			kind: "entity_schema" as const,
			id: sourceSnapshot(value).entitySchemaId,
		})),
		Match.when({ kind: "event" }, (value) => ({
			kind: "event_schema" as const,
			id: sourceSnapshot(value).eventSchemaId,
		})),
		Match.when({ kind: "relationship" }, (value) => ({
			kind: "relationship_schema" as const,
			id: sourceSnapshot(value).relationshipSchemaId,
		})),
		Match.exhaustive,
	);

const decodeSnapshot = <A extends { properties: Record<string, unknown> }>(snapshot: A) =>
	decodeProperties(snapshot.properties).pipe(
		Effect.map((properties) => ({ ...snapshot, properties })),
	);

const decodeSnapshots = <A extends { properties: Record<string, unknown> }>(source: {
	after?: A;
	before?: A;
}) =>
	Effect.all({
		...(source.after ? { after: decodeSnapshot(source.after) } : {}),
		...(source.before ? { before: decodeSnapshot(source.before) } : {}),
	});

const decodeSource = (source: LifecycleSource) =>
	Match.value(source).pipe(
		Match.when({ kind: "entity" }, (value) =>
			decodeSnapshots(value).pipe(
				Effect.map((snapshots) => ({ kind: "entity", ...snapshots }) as const),
			),
		),
		Match.when({ kind: "event" }, (value) =>
			decodeSnapshots(value).pipe(
				Effect.map((snapshots) => ({ kind: "event", ...snapshots }) as const),
			),
		),
		Match.when({ kind: "relationship" }, (value) =>
			decodeSnapshots(value).pipe(
				Effect.map((snapshots) => ({ kind: "relationship", ...snapshots }) as const),
			),
		),
		Match.exhaustive,
	);

export const LifecycleDispatchLive = Layer.effect(
	LifecycleDispatch,
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const automations = yield* AutomationsService;

		return {
			dispatch: (input: LifecycleDispatchInput) =>
				Effect.gen(function* () {
					const operation = input.operation ?? "create";
					const source = yield* decodeSource(input.source);
					const rules = yield* automations.resolveActive({
						operation,
						rowUserId: input.rowUserId,
						target: targetForSource(input.source),
					});

					const starts = yield* Effect.forEach(
						rules,
						(rule) =>
							engine
								.execute(SubscriptionExecutionWorkflow, {
									discard: true,
									executionId: `lifecycle:${input.occurrenceId}:${rule.id}`,
									payload: {
										source,
										operation,
										ruleId: rule.id,
										origin: input.origin,
										sourceKind: source.kind,
										recordId: input.recordId,
										rowUserId: input.rowUserId,
										occurredAt: input.occurredAt,
										occurrenceId: input.occurrenceId,
										...(input.population ? { population: input.population } : {}),
									},
								})
								.pipe(Effect.either),
						{ concurrency: "unbounded" },
					);
					const failed = starts.find(Either.isLeft);
					if (failed) {
						return yield* new DbError({ message: unknownToMessage(failed.left) });
					}
					return yield* Effect.void;
				}).pipe(Effect.mapError((error) => new DbError({ message: unknownToMessage(error) }))),
		};
	}),
);
