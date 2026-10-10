import { ImpersonationAuthorization } from "@ryot-app/contract/oauth";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Schema } from "effect";

import type { ServerOrigin } from "#/api/origin";
import { OAuthLauncher, OAuthLauncherError } from "#/modules/auth/oauth-launcher";
import { GodModeService } from "#/modules/god-mode/service";

const IMPERSONATION_HANDOFF_PATH = "/oauth/impersonate";

export class GodModeImpersonationService extends Context.Service<GodModeImpersonationService>()(
	"GodModeImpersonationService",
	{
		make: Effect.gen(function* () {
			const godMode = yield* GodModeService;
			const launcher = yield* OAuthLauncher;

			const start = Effect.fn("GodModeImpersonationService.start")(function* (
				sessionId: string,
				userId: UserId,
				serverOrigin: ServerOrigin,
			) {
				const plan = yield* launcher.prepareImpersonation(serverOrigin);
				const authorization = yield* Schema.decodeUnknownEffect(ImpersonationAuthorization)({
					nonce: plan.pending.nonce,
					state: plan.pending.state,
					clientId: plan.client.clientId,
					codeChallenge: plan.codeChallenge,
					redirectUri: plan.pending.redirectUri,
				}).pipe(
					Effect.mapError(
						(cause) => new OAuthLauncherError({ cause, reason: "unknown-native-application" }),
					),
				);
				const { ticket } = yield* godMode.startUserImpersonation(sessionId, userId, authorization);
				const handoffUrl = new URL(IMPERSONATION_HANDOFF_PATH, serverOrigin);
				handoffUrl.hash = new URLSearchParams({ ticket }).toString();
				yield* launcher.launch(plan, handoffUrl.toString());
			});

			return { start };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
