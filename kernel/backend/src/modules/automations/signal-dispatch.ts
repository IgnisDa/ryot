import { DbError, unknownToMessage } from "@ryot/contract/errors";
import { AutomationProperties } from "@ryot/contract/modules/automations/schemas";
import { SignalSchemaSlug } from "@ryot/contract/schema/brands";
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
					const scopes = [input.actorUserId, ...input.recipientUserIds].filter(
						(value, index, values) => values.indexOf(value) === index,
					);
					const matches = yield* Effect.forEach(scopes, (rowUserId) =>
						automations
							.resolveActive({
								rowUserId,
								operation: "signal",
								target: {
									id: SignalSchemaSlug.make(input.signalSchemaSlug),
									kind: "signal_schema",
								},
							})
							.pipe(Effect.map((rules) => rules.map((rule) => ({ rowUserId, rule })))),
					);
					const uniqueMatches = matches
						.flat()
						.filter(
							(match, index, values) =>
								values.findIndex(({ rule }) => rule.id === match.rule.id) === index,
						);

					const starts = yield* Effect.forEach(
						uniqueMatches,
						({ rowUserId, rule }) =>
							engine
								.execute(SubscriptionExecutionWorkflow, {
									discard: true,
									executionId: `subscription:${input.id}:${rule.id}`,
									payload: {
										rowUserId,
										ruleId: rule.id,
										signalId: input.id,
										operation: "signal",
										sourceKind: "signal",
										origin: input.origin,
										occurrenceId: input.id,
										occurredAt: input.occurredAt,
										source: {
											kind: "signal",
											signal: {
												properties,
												id: input.id,
												origin: input.origin,
												occurredAt: input.occurredAt,
												signalSchemaSlug: input.signalSchemaSlug,
											},
										},
									},
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
