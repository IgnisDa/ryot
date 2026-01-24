import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { DbError, unknownToMessage } from "@ryot/contract/errors";
import { AutomationRuleMetadata } from "@ryot/contract/modules/automations/schemas";
import { Effect, Either, Layer, Match, Schema } from "effect";

import {
	LifecycleDispatch,
	type LifecycleDispatchInput,
	type LifecycleSource,
} from "#modules/entities/lifecycle-dispatch";

import type { AutomationRuleTarget } from "./repository";
import { AutomationsService } from "./service";
import { SubscriptionExecutionWorkflow } from "./subscription-execution-workflow";

const decodeProperties = Schema.decodeUnknown(
	Schema.Record({ key: Schema.String, value: AutomationRuleMetadata }),
);

const targetForSource = (source: LifecycleSource): AutomationRuleTarget =>
	Match.value(source).pipe(
		Match.when({ kind: "entity" }, ({ after }) => ({
			kind: "entity_schema" as const,
			id: after.entitySchemaId,
		})),
		Match.when({ kind: "event" }, ({ after }) => ({
			kind: "event_schema" as const,
			id: after.eventSchemaId,
		})),
		Match.when({ kind: "relationship" }, ({ after }) => ({
			kind: "relationship_schema" as const,
			id: after.relationshipSchemaId,
		})),
		Match.exhaustive,
	);

const decodeSource = (source: LifecycleSource) =>
	Match.value(source).pipe(
		Match.when({ kind: "entity" }, ({ after }) =>
			decodeProperties(after.properties).pipe(
				Effect.map((properties) => ({ kind: "entity", after: { ...after, properties } }) as const),
			),
		),
		Match.when({ kind: "event" }, ({ after }) =>
			decodeProperties(after.properties).pipe(
				Effect.map((properties) => ({ kind: "event", after: { ...after, properties } }) as const),
			),
		),
		Match.when({ kind: "relationship" }, ({ after }) =>
			decodeProperties(after.properties).pipe(
				Effect.map(
					(properties) => ({ kind: "relationship", after: { ...after, properties } }) as const,
				),
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
					const source = yield* decodeSource(input.source);
					const rules = yield* automations.resolveActive({
						operation: "create",
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
										ruleId: rule.id,
										operation: "create",
										origin: input.origin,
										sourceKind: source.kind,
										recordId: input.recordId,
										rowUserId: input.rowUserId,
										occurredAt: input.occurredAt,
										occurrenceId: input.occurrenceId,
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
