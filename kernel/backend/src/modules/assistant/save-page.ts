import { DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import {
	AssistantError,
	SaveAssistantPageBody,
	SaveAssistantPageResult,
} from "@ryot-app/contract/modules/assistant/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { AuthService } from "#modules/accounts/auth/service";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { idempotencyIdentity, IdempotencyKeys } from "#modules/mutations/idempotency";
import { PageAuthoringService } from "#modules/pages/authoring/service";
import { SavedViewsService } from "#modules/saved-views/service";
import { DatabaseSession } from "#platform/db/session";

import { AssistantRepository } from "./repository";

const previewNotFound = () => new AssistantError({ reason: { code: "page-preview-not-found" } });
export const makeAssistantSavePage = Effect.fn(function* ({
	pages,
	views,
	resolveAccount,
}: {
	readonly views: Pick<SavedViewsService["Service"], "create">;
	readonly pages: Pick<PageAuthoringService["Service"], "publishCompiledDraft">;
	readonly resolveAccount: (
		userId: UserId,
	) => Effect.Effect<
		{
			readonly user: { readonly id: UserId };
			readonly authorization: { readonly accessClass: "demo" | "standard" };
		},
		Effect.Error<ReturnType<AuthService["Service"]["resolveTrustedAccount"]>>
	>;
}) {
	const session = yield* DatabaseSession;
	const admission = yield* AccountAdmission.make;
	const keys = yield* IdempotencyKeys;
	const repository = yield* AssistantRepository;
	const save = Effect.fn("AssistantSavePage.save")(
		function* (userId: UserId, input: SaveAssistantPageBody) {
			const { user, authorization } = yield* resolveAccount(userId);
			if (authorization.accessClass === "demo") {
				return yield* new DemoOperationProtected({ reason: { code: "demo-operation-protected" } });
			}
			const key = `assistant:${input.conversationId}:${input.requestId}`;
			const identity = (kind: string) => idempotencyIdentity({ key, kind, userId, request: input });
			const transact = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
				session.transaction(
					Effect.gen(function* () {
						yield* admission.admitAccount(userId);
						return yield* effect;
					}),
				);
			const previous = yield* transact(
				Effect.gen(function* () {
					yield* keys.once(
						identity("assistant:save-admission"),
						SaveAssistantPageBody,
						Effect.succeed(input),
					);
					return yield* keys.read(identity("assistant:save-result"), SaveAssistantPageResult);
				}),
			);
			if (previous) {
				return previous.response;
			}
			const state = yield* repository.loadTurn(userId, input.turnId);
			if (
				!state ||
				state.turn.conversationId !== input.conversationId ||
				!state.messages.some(
					(message) =>
						message.turnId === input.turnId &&
						message.parts.some(
							(part) =>
								part.kind === "page-preview" &&
								part.pageId === input.pageId &&
								part.draftRevision === input.draftRevision &&
								part.artifactHash === input.artifactHash &&
								part.definitionHash === input.definitionHash,
						),
				)
			) {
				return yield* previewNotFound();
			}
			const published = yield* pages.publishCompiledDraft(
				userId,
				{
					pageId: input.pageId,
					artifactHash: input.artifactHash,
					draftRevision: input.draftRevision,
					definitionHash: input.definitionHash,
				},
				`${key}:publish`,
			);
			if (!published) {
				return yield* previewNotFound();
			}
			const view = yield* views.create(
				user,
				{
					settings: {},
					name: input.name,
					slug: input.slug,
					icon: input.icon,
					dataSources: null,
					renderer: { kind: "page", pageId: input.pageId },
				},
				undefined,
				`${key}:view`,
			);
			return yield* transact(
				keys.once(
					identity("assistant:save-result"),
					SaveAssistantPageResult,
					Effect.succeed({ pageId: input.pageId, savedViewId: view.id }),
				),
			);
		},
		Effect.catchTag("IdempotencyConflict", () =>
			Effect.fail(new AssistantError({ reason: { code: "request-conflict" } })),
		),
	);
	return { save };
});

export class AssistantSavePage extends Context.Service<AssistantSavePage>()(
	"@ryot-app/kernel-backend/modules/assistant/save-page/AssistantSavePage",
	{
		make: Effect.gen(function* () {
			const auth = yield* AuthService;
			return yield* makeAssistantSavePage({
				views: yield* SavedViewsService,
				pages: yield* PageAuthoringService,
				resolveAccount: auth.resolveTrustedAccount,
			});
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
