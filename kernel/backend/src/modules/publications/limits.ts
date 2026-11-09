import { PublicationRateLimited } from "@ryot-app/contract/modules/publications/schemas";
import { Clock, Context, Effect, Layer } from "effect";

const EXCHANGES_PER_MINUTE = 10;
const SESSION_CONCURRENCY = 6;
const MAX_TRACKED_WINDOWS = 10_000;
const WINDOW_MS = 60_000;
const UNKNOWN_ADDRESS = "unknown";

const rateLimited = () =>
	new PublicationRateLimited({ reason: { code: "publication-rate-limited" } });

export class PublicationVisitLimits extends Context.Service<PublicationVisitLimits>()(
	"@ryot-app/kernel-backend/modules/publications/limits/PublicationVisitLimits",
	{
		make: Effect.sync(() => {
			const exchanges = new Map<string, { count: number; windowStart: number }>();
			const inFlight = new Map<string, number>();

			const consumeExchange = (visitorAddress: string, now: number) => {
				const window = exchanges.get(visitorAddress);
				if (window !== undefined && now - window.windowStart < WINDOW_MS) {
					window.count += 1;
					return window.count <= EXCHANGES_PER_MINUTE;
				}
				if (exchanges.size >= MAX_TRACKED_WINDOWS) {
					for (const [key, tracked] of exchanges) {
						if (now - tracked.windowStart >= WINDOW_MS) {
							exchanges.delete(key);
						}
					}
				}
				exchanges.set(visitorAddress, { count: 1, windowStart: now });
				return true;
			};

			const admitExchange = Effect.fn("PublicationVisitLimits.admitExchange")(function* (
				visitorAddress: null | string,
			) {
				const now = yield* Clock.currentTimeMillis;
				yield* Effect.succeed(consumeExchange(visitorAddress ?? UNKNOWN_ADDRESS, now)).pipe(
					Effect.filterOrFail(Boolean, rateLimited),
				);
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
	static readonly layer = Layer.effect(this, this.make);
}
