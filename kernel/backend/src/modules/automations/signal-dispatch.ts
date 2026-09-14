import { DbError, unknownToMessage } from "@ryot-app/contract/errors";
import { AutomationProperties } from "@ryot-app/contract/modules/automations/schemas";
import { AutomationOccurrenceId, SignalSchemaSlug } from "@ryot-app/contract/schema/brands";
import { Effect, Result, Layer, Schema } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { SignalDispatch } from "#modules/signals/dispatch";
import type { SignalDispatchInput } from "#modules/signals/dispatch";

import { AutomationsService } from "./service";
import { SubscriptionExecutionWorkflow } from "./subscription-execution-workflow";

export const SignalDispatchLive = Layer.effect(
	SignalDispatch,
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const automations = yield* AutomationsService;

		return {
			dispatch: (input: SignalDispatchInput) =>
				Effect.gen(function* () {
					const properties = yield* Schema.decodeUnknownEffect(AutomationProperties)(
						input.properties,
					);
					const occurrenceId = AutomationOccurrenceId.make(input.id);
					yield* automations.recordOccurrence({
						userId: null,
						recordId: null,
						id: occurrenceId,
						population: null,
						signalId: input.id,
						operation: "signal",
						origin: input.origin,
						sourceKind: "signal",
						occurredAt: input.occurredAt,
						source: {
							kind: "signal",
							signal: {
								properties,
								id: input.id,
								origin: input.origin,
								occurredAt: input.occurredAt,
								signalSchemaSlug: SignalSchemaSlug.make(input.signalSchemaSlug),
							},
						},
					});
					const scopes = [input.actorUserId, ...input.recipientUserIds].filter(
						(value, index, values) => values.indexOf(value) === index,
					);
					const matches = yield* Effect.forEach(scopes, (rowUserId) =>
						automations
							.resolveActive({
								rowUserId,
								operation: "signal",
								target: {
									kind: "signal_schema",
									id: SignalSchemaSlug.make(input.signalSchemaSlug),
								},
							})
							.pipe(Effect.map((rules) => rules.map((rule) => ({ rule, rowUserId })))),
					);
					const uniqueMatches = matches
						.flat()
						.filter(
							(match, index, values) =>
								values.findIndex(({ rule }) => rule.id === match.rule.id) === index,
						);

					const starts = yield* Effect.forEach(
						uniqueMatches,
						({ rule, rowUserId }) =>
							engine
								.execute(SubscriptionExecutionWorkflow, {
									discard: true,
									executionId: `subscription:${input.id}:${rule.id}`,
									payload: { rowUserId, occurrenceId, ruleId: rule.id },
								})
								.pipe(Effect.result),
						{ concurrency: "unbounded" },
					);
					const failed = starts.find(Result.isFailure);
					if (failed) {
						return yield* new DbError({ message: unknownToMessage(failed.failure) });
					}
					return yield* Effect.void;
				}).pipe(Effect.mapError((error) => new DbError({ message: unknownToMessage(error) }))),
		};
	}),
);
