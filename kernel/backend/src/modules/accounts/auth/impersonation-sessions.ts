import { UserId } from "@ryot-app/contract/schema/brands";
import { Clock, Context, Effect, Layer } from "effect";

import { LifecycleWriteGuard } from "./lifecycle-write-guard";
import { AuthRepository } from "./repository";

export class ImpersonationSessions extends Context.Service<ImpersonationSessions>()(
	"ImpersonationSessions",
	{
		make: Effect.gen(function* () {
			const repository = yield* AuthRepository;
			const lifecycle = yield* LifecycleWriteGuard;
			const getActive = Effect.fn("ImpersonationSessions.getActive")(function* (
				sessionId: string,
				userId: string,
			) {
				const session = yield* repository.findSession(sessionId);
				const now = yield* Clock.currentTimeMillis;
				if (
					!session ||
					session.userId !== userId ||
					session.disabledAt ||
					!session.bootstrapCompletedAt ||
					!session.impersonationExpiresAt ||
					session.expiresAt.getTime() <= now ||
					session.impersonationExpiresAt.getTime() <= now ||
					(yield* lifecycle.isActive(UserId.make(session.userId)))
				) {
					return null;
				}
				return { expiresAt: session.impersonationExpiresAt.getTime() };
			});
			return { getActive };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(AuthRepository.layer),
		Layer.provide(LifecycleWriteGuard.layer),
	);
}
