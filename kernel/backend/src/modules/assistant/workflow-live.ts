import { AssistantTurnFailure } from "@ryot-app/contract/modules/assistant/schemas";
import { Effect, Layer, Option, Schema } from "effect";
import { DurableDeferred } from "effect/workflow";

import { implementWorkflow, makeActivity } from "#platform/workflow/scope";

import { assistantMaxRounds } from "./context";
import { AssistantRound, type AssistantTurnPayload, AssistantTurnRuntime } from "./turn-runtime";
import { assistantApproval, AssistantTurnWorkflow } from "./workflow";

const executionFailure = (): AssistantTurnFailure => ({ code: "execution-failed" });
const activity = <E, R>(name: string, execute: Effect.Effect<void, E, R>) =>
	makeActivity({
		name,
		success: Schema.Void,
		error: AssistantTurnFailure,
		execute: execute.pipe(Effect.mapError(executionFailure)),
	});

export const AssistantWorkflowLive = Layer.unwrap(
	Effect.gen(function* () {
		const runtime = yield* AssistantTurnRuntime;
		return implementWorkflow(AssistantTurnWorkflow, (payload: AssistantTurnPayload) =>
			Effect.gen(function* () {
				const awaitDecision = Effect.fn(function* (callId: string) {
					const decision = yield* runtime
						.decision(payload, callId)
						.pipe(Effect.mapError(executionFailure));
					if (decision === null) {
						yield* DurableDeferred.await(assistantApproval(callId));
					}
				});
				const dispatch = (name: string, callId: string) =>
					makeActivity({
						name,
						error: AssistantTurnFailure,
						success: Schema.NullOr(Schema.String),
						execute: runtime.dispatch(payload, callId).pipe(Effect.mapError(executionFailure)),
					});
				if (!(yield* runtime.isActive(payload).pipe(Effect.mapError(executionFailure)))) {
					return undefined;
				}
				for (let round = 1; round <= assistantMaxRounds; round += 1) {
					const result = yield* makeActivity({
						success: AssistantRound,
						error: AssistantTurnFailure,
						name: `round:${round}:generate`,
						execute: runtime
							.generate(payload, round)
							.pipe(
								Effect.mapError((error) =>
									Schema.decodeUnknownOption(AssistantTurnFailure)(error).pipe(
										Option.getOrElse(executionFailure),
									),
								),
							),
					});
					yield* activity(`round:${round}:persist`, runtime.recordRound(payload, round, result));
					for (const call of result.calls) {
						if (call.requiresApproval) {
							yield* awaitDecision(call.id);
						}
						let pending = yield* dispatch(`call:${call.id}`, call.id);
						while (pending !== null) {
							yield* awaitDecision(pending);
							pending = yield* dispatch(`call:${call.id}:after:${pending}`, call.id);
						}
					}
					if (result.calls.length === 0) {
						yield* activity("complete", runtime.finish(payload, null));
						return undefined;
					}
				}
				return yield* Effect.fail({ code: "round-limit" } satisfies AssistantTurnFailure);
			}).pipe(Effect.catch((error) => activity("fail", runtime.finish(payload, error)))),
		);
	}),
);
