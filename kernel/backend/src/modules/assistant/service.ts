import { DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import {
	type AnswerAssistantQuestionBody,
	type AssistantApprovalDecision,
	AssistantError,
	type DecideAssistantToolCallBody,
	type InterruptAssistantTurnBody,
	type RenameAssistantConversationBody,
	type SubmitAssistantTurnBody,
} from "@ryot-app/contract/modules/assistant/schemas";
import { AssistantConversationId, AssistantTurnId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";
import { DurableDeferred } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { AuthService } from "#modules/accounts/auth/service";
import { publishAssistantUpdated } from "#modules/live-updates/publish";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import { DatabaseSession } from "#platform/db/session";

import { AssistantRepository } from "./repository";
import { assistantApproval, AssistantTurnWorkflow } from "./workflow";

export const makeAssistantService = Effect.fn(function* (
	resolveAccount: (
		userId: UserId,
	) => Effect.Effect<
		Pick<
			Effect.Success<ReturnType<AuthService["Service"]["resolveTrustedAccount"]>>,
			"authorization"
		>,
		Effect.Error<ReturnType<AuthService["Service"]["resolveTrustedAccount"]>>
	>,
) {
	const repository = yield* AssistantRepository;
	const session = yield* DatabaseSession;
	const admission = yield* AccountAdmission.make;
	const engine = yield* WorkflowEngine;
	const transact = <A, E, R>(userId: UserId, effect: Effect.Effect<A, E, R>) =>
		session.transaction(
			Effect.gen(function* () {
				yield* resolveAccount(userId);
				yield* admission.admitAccount(userId);
				return yield* effect;
			}),
		);
	const start = (userId: UserId, turnId: string) =>
		dispatchAdmittedWorkflow(engine, AssistantTurnWorkflow, userId, {
			discard: true,
			payload: { userId, turnId },
		});
	const submit = Effect.fn("AssistantService.submit")(function* (
		userId: UserId,
		input: SubmitAssistantTurnBody,
	) {
		const turn = yield* transact(
			userId,
			repository
				.submit(userId, input)
				.pipe(
					Effect.tap((updated) =>
						publishAssistantUpdated(
							userId,
							updated.conversationId,
							updated.id,
							updated.revision,
						).pipe(Effect.provideService(DatabaseSession, session)),
					),
				),
		);
		if (
			turn.requestId === input.requestId &&
			["queued", "running", "awaiting-input", "awaiting-approval"].includes(turn.status)
		) {
			yield* start(userId, turn.id);
		}
		return {
			turnId: AssistantTurnId.make(turn.id),
			conversationId: AssistantConversationId.make(turn.conversationId),
		};
	});
	const wake = Effect.fn(function* (
		userId: UserId,
		turnId: string,
		toolCallId: string,
		decision: AssistantApprovalDecision,
	) {
		const deferred = assistantApproval(toolCallId);
		const executionId = yield* AssistantTurnWorkflow.executionId({ userId, turnId });
		yield* DurableDeferred.succeed(deferred, {
			value: decision,
			token: DurableDeferred.tokenFromExecutionId(deferred, {
				executionId,
				workflow: AssistantTurnWorkflow,
			}),
		}).pipe(Effect.provideService(WorkflowEngine, engine));
	});
	const interrupt = Effect.fn("AssistantService.interrupt")(function* (
		userId: UserId,
		input: InterruptAssistantTurnBody,
	) {
		const { turn, next, awaitingDecision } = yield* transact(
			userId,
			repository
				.interrupt(userId, input.conversationId, input.turnId)
				.pipe(
					Effect.tap(({ next: queued, turn: updated }) =>
						Effect.forEach(queued === null ? [updated] : [updated, queued], (changed) =>
							publishAssistantUpdated(userId, changed.conversationId, changed.id, changed.revision),
						).pipe(Effect.provideService(DatabaseSession, session)),
					),
				),
		);
		for (const toolCallId of awaitingDecision) {
			yield* wake(userId, turn.id, toolCallId, "decline");
		}
		if (next !== null) {
			yield* start(userId, next.id);
		}
		return { turnId: input.turnId, conversationId: input.conversationId };
	});
	const decide = Effect.fn("AssistantService.decide")(function* (
		userId: UserId,
		input: DecideAssistantToolCallBody,
	) {
		yield* transact(
			userId,
			Effect.gen(function* () {
				const { authorization } = yield* resolveAccount(userId);
				if (authorization.accessClass === "demo") {
					return yield* new DemoOperationProtected({
						reason: { code: "demo-operation-protected" },
					});
				}
				yield* repository.decide(userId, input);
				const state = yield* repository.loadTurn(userId, input.turnId);
				if (!state) {
					return yield* new AssistantError({ reason: { code: "turn-not-found" } });
				}
				yield* publishAssistantUpdated(
					userId,
					input.conversationId,
					input.turnId,
					state.turn.revision,
				).pipe(Effect.provideService(DatabaseSession, session));
				return undefined;
			}),
		);
		yield* wake(userId, input.turnId, input.toolCallId, input.decision);
		return { turnId: input.turnId, conversationId: input.conversationId };
	});
	const answer = Effect.fn("AssistantService.answer")(function* (
		userId: UserId,
		input: AnswerAssistantQuestionBody,
	) {
		yield* transact(
			userId,
			Effect.gen(function* () {
				yield* repository.answer(userId, input);
				const state = yield* repository.loadTurn(userId, input.turnId);
				if (!state) {
					return yield* new AssistantError({ reason: { code: "turn-not-found" } });
				}
				yield* publishAssistantUpdated(
					userId,
					input.conversationId,
					input.turnId,
					state.turn.revision,
				).pipe(Effect.provideService(DatabaseSession, session));
				return undefined;
			}),
		);
		yield* wake(userId, input.turnId, input.toolCallId, "approve");
		return { turnId: input.turnId, conversationId: input.conversationId };
	});
	const recover = Effect.fn("AssistantService.recover")(function* () {
		for (const turn of yield* repository.recoverableTurns) {
			const userId = UserId.make(turn.userId);
			yield* resolveAccount(userId).pipe(
				Effect.flatMap(() => start(userId, turn.id)),
				Effect.catch((error) => Effect.logWarning("Assistant admission recovery refused", error)),
			);
		}
	});
	return {
		submit,
		decide,
		answer,
		recover,
		interrupt,
		deleteConversation: (userId: UserId, conversationId: string) =>
			transact(userId, repository.deleteConversation(userId, conversationId)).pipe(
				Effect.as({ conversationId: AssistantConversationId.make(conversationId) }),
			),
		renameConversation: (userId: UserId, input: RenameAssistantConversationBody) =>
			transact(
				userId,
				repository.renameConversation(userId, input.conversationId, input.title),
			).pipe(Effect.as({ conversationId: input.conversationId })),
	};
});

export class AssistantService extends Context.Service<AssistantService>()(
	"@ryot-app/kernel-backend/modules/assistant/service/AssistantService",
	{
		make: Effect.gen(function* () {
			const auth = yield* AuthService;
			return yield* makeAssistantService(auth.resolveTrustedAccount);
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
