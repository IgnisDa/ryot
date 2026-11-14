import { PublicationRateLimited } from "@ryot-app/contract/modules/publications/schemas";
import { Context, Duration, Effect, Layer } from "effect";
import { RateLimiter } from "effect/persistence";

const EXCHANGES_PER_MINUTE = 10;
const SESSION_CONCURRENCY = 6;
const UNKNOWN_ADDRESS = "unknown";

const rateLimited = () =>
	new PublicationRateLimited({ reason: { code: "publication-rate-limited" } });

export class PublicationVisitLimits extends Context.Service<PublicationVisitLimits>()(
	"@ryot-app/kernel-backend/modules/publications/limits/PublicationVisitLimits",
	{
		make: Effect.gen(function* () {
			const limiter = yield* RateLimiter.RateLimiter;
			const inFlight = new Map<string, number>();

			const admitExchange = Effect.fn("PublicationVisitLimits.admitExchange")(function* (
				visitorAddress: null | string,
			) {
				yield* limiter
					.consume({
						limit: EXCHANGES_PER_MINUTE,
						window: Duration.minutes(1),
						key: visitorAddress ?? UNKNOWN_ADDRESS,
					})
					.pipe(Effect.mapError(rateLimited));
			});

			const withSessionPermit = <A, E, R>(sessionKey: string, work: Effect.Effect<A, E, R>) =>
				Effect.acquireUseRelease(
					Effect.suspend(() => {
						const current = inFlight.get(sessionKey) ?? 0;
						if (current >= SESSION_CONCURRENCY) {
							return Effect.fail(rateLimited());
						}
						inFlight.set(sessionKey, current + 1);
						return Effect.void;
					}),
					() => work,
					() =>
						Effect.sync(() => {
							const remaining = (inFlight.get(sessionKey) ?? 1) - 1;
							if (remaining <= 0) {
								inFlight.delete(sessionKey);
							} else {
								inFlight.set(sessionKey, remaining);
							}
						}),
				);

			return { admitExchange, withSessionPermit };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(RateLimiter.layer),
		Layer.provide(RateLimiter.layerStoreMemory),
	);
}
