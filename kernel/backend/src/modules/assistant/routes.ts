import {
	AuthorizationContext,
	AuthUnauthorized,
	CurrentUser,
	DemoOperationProtected,
	UserInitializing,
} from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { DbError } from "@ryot-app/contract/errors";
import { AssistantError } from "@ryot-app/contract/modules/assistant/schemas";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { AssistantProviderConfiguration } from "./provider-configuration";
import { AssistantSavePage } from "./save-page";
import { AssistantService } from "./service";

const command = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	code?: "provider-invalid" | "page-save-failed",
) =>
	effect.pipe(
		Effect.catch(
			(
				error,
			): Effect.Effect<
				never,
				AssistantError | AuthUnauthorized | UserInitializing | DemoOperationProtected
			> => {
				if (
					error instanceof AssistantError ||
					error instanceof AuthUnauthorized ||
					error instanceof DemoOperationProtected ||
					error instanceof UserInitializing
				) {
					return Effect.fail(error);
				}
				if (error instanceof DbError) {
					return Effect.die(error);
				}
				if (code !== undefined) {
					return Effect.fail(new AssistantError({ reason: { code } }));
				}
				return Effect.die(error);
			},
		),
	);

export const AssistantRoutesLive = HttpApiBuilder.group(AppContract, "assistant", (handlers) => {
	return handlers
		.handle("createConversation", ({ payload }) =>
			Effect.gen(function* () {
				return yield* command(
					(yield* AssistantService).createConversation((yield* CurrentUser).id, payload.title),
				);
			}),
		)
		.handle("deleteConversation", ({ payload }) =>
			Effect.gen(function* () {
				return yield* command(
					(yield* AssistantService).deleteConversation(
						(yield* CurrentUser).id,
						payload.conversationId,
					),
				);
			}),
		)
		.handle("submit", ({ payload }) =>
			Effect.gen(function* () {
				return yield* command((yield* AssistantService).submit((yield* CurrentUser).id, payload));
			}),
		)
		.handle("decide", ({ payload }) =>
			Effect.gen(function* () {
				return yield* command((yield* AssistantService).decide((yield* CurrentUser).id, payload));
			}),
		)
		.handle("providerMetadata", () =>
			Effect.gen(function* () {
				return yield* (yield* AssistantProviderConfiguration)
					.metadata((yield* CurrentUser).id)
					.pipe(Effect.orDie);
			}),
		)
		.handle("configureProvider", ({ payload }) =>
			Effect.gen(function* () {
				return yield* command(
					(yield* AssistantProviderConfiguration).configure(
						(yield* CurrentUser).id,
						(yield* AuthorizationContext).accessClass,
						payload,
					),
					"provider-invalid",
				);
			}),
		)
		.handle("deleteProvider", () =>
			Effect.gen(function* () {
				return yield* command(
					(yield* AssistantProviderConfiguration).remove(
						(yield* CurrentUser).id,
						(yield* AuthorizationContext).accessClass,
					),
				);
			}),
		)
		.handle("savePage", ({ payload }) =>
			Effect.gen(function* () {
				return yield* command(
					(yield* AssistantSavePage).save((yield* CurrentUser).id, payload),
					"page-save-failed",
				);
			}),
		);
});
