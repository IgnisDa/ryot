import { InternalError, internalError, unknownToMessage } from "@ryot-app/contract/errors";
import { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Cause, Context, Duration, Effect, Layer, Result, Schema } from "effect";
import { DurableClock, Workflow } from "effect/unstable/workflow";

import type { DurableSchema } from "#lib/infrastructure/workflow";
import { implementWorkflow, makeActivity } from "#lib/infrastructure/workflow-scope";

import { UserBootstrap } from "./bootstrap";

const UserBootstrapWorkflowPayload = Schema.Struct({
	userId: UserId,
	accountGeneration: AccountGeneration,
	generation: Schema.optional(Schema.String),
});
type UserBootstrapWorkflowPayload = typeof UserBootstrapWorkflowPayload.Type;

export const UserBootstrapWorkflow = Workflow.make("UserBootstrapWorkflow", {
	error: Schema.Never satisfies DurableSchema,
	success: Schema.Void satisfies DurableSchema,
	payload: UserBootstrapWorkflowPayload satisfies DurableSchema,
	idempotencyKey: ({ accountGeneration }) => accountGeneration.token,
});

export class UserBootstrapWorkflowOperations extends Context.Service<
	UserBootstrapWorkflowOperations,
	{
		perform: (
			userId: UserId,
			accountGeneration: AccountGeneration,
			generation?: string,
		) => Effect.Effect<void, InternalError>;
	}
>()("UserBootstrapWorkflowOperations") {}

export const UserBootstrapWorkflowOperationsLive = Layer.effect(
	UserBootstrapWorkflowOperations,
	Effect.gen(function* () {
		const bootstrap = yield* UserBootstrap;
		return {
			perform: (userId: UserId, accountGeneration: AccountGeneration, generation?: string) =>
				bootstrap.perform(userId, accountGeneration, generation).pipe(
					Effect.catchCauseIf(
						(cause) => !Cause.hasInterruptsOnly(cause),
						(cause) =>
							Effect.logError("user bootstrap attempt failed", cause).pipe(
								Effect.annotateLogs({ userId }),
								Effect.andThen(internalError("User bootstrap attempt failed")),
							),
					),
					Effect.mapError((error) => internalError(unknownToMessage(error))),
				),
		};
	}),
);

export const runUserBootstrapWorkflow = Effect.fn("UserBootstrapWorkflow")(function* (
	payload: UserBootstrapWorkflowPayload,
	executionId: string,
) {
	yield* Effect.annotateCurrentSpan({ executionId, userId: payload.userId });
	const operations = yield* UserBootstrapWorkflowOperations;
	let attempt = 1;
	const performAttempt = (attemptNumber: number) =>
		makeActivity({
			name: `bootstrap-user-${attemptNumber}`,
			error: InternalError satisfies DurableSchema,
			success: Schema.Void satisfies DurableSchema,
			execute: operations.perform(payload.userId, payload.accountGeneration, payload.generation),
		}).pipe(Effect.result);
	let result = yield* performAttempt(attempt);
	while (Result.isFailure(result)) {
		yield* Effect.logWarning("user bootstrap will retry", result.failure).pipe(
			Effect.annotateLogs({ attempt, userId: payload.userId }),
		);
		const delayMs = Math.min(5 * 60_000, 1_000 * 2 ** Math.min(attempt - 1, 12));
		yield* DurableClock.sleep({
			duration: Duration.millis(delayMs),
			name: `user-bootstrap-retry-${attempt}`,
		});
		attempt += 1;
		result = yield* performAttempt(attempt);
	}
});

export const UserBootstrapWorkflowDefinitionsLive = implementWorkflow(
	UserBootstrapWorkflow,
	runUserBootstrapWorkflow,
);
