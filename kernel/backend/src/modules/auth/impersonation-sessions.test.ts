import { expect, layer } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Clock, Context, DateTime, Effect, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";

import { ImpersonationSessions } from "./impersonation-sessions";
import { LifecycleWriteGuard } from "./lifecycle-write-guard";
import { AuthRepository } from "./repository";

type SessionRecord = {
	readonly id: string;
	readonly userId: string;
	readonly expiresAt: Date;
	readonly impersonationExpiresAt: Date | null;
	readonly disabledAt: Date | null;
	readonly bootstrapCompletedAt: Date | null;
};

class ImpersonationSessionState extends Context.Service<
	ImpersonationSessionState,
	{
		readonly setSession: (session: SessionRecord | null) => Effect.Effect<void>;
		readonly setLifecycleActive: (active: boolean) => Effect.Effect<void>;
		readonly sessionReads: Effect.Effect<ReadonlyArray<string>>;
		readonly lifecycleReads: Effect.Effect<ReadonlyArray<string>>;
	}
>()("test/ImpersonationSessionState") {}

const makeLayer = () =>
	Layer.unwrap(
		Effect.gen(function* () {
			const session = yield* Ref.make<SessionRecord | null>(null);
			const lifecycleActive = yield* Ref.make(false);
			const sessionReads = yield* Ref.make<ReadonlyArray<string>>([]);
			const lifecycleReads = yield* Ref.make<ReadonlyArray<string>>([]);
			const repository = Layer.mock(AuthRepository)({
				findSession: (sessionId) =>
					Ref.update(sessionReads, (reads) => [...reads, sessionId]).pipe(
						Effect.andThen(Ref.get(session)),
					),
			});
			const lifecycle = Layer.mock(LifecycleWriteGuard)({
				isActive: (userId) =>
					Ref.update(lifecycleReads, (reads) => [...reads, userId]).pipe(
						Effect.andThen(Ref.get(lifecycleActive)),
					),
			});

			return Layer.effect(ImpersonationSessions, ImpersonationSessions.make).pipe(
				Layer.provideMerge(Layer.merge(repository, lifecycle)),
				Layer.merge(
					Layer.succeed(ImpersonationSessionState, {
						sessionReads: Ref.get(sessionReads),
						lifecycleReads: Ref.get(lifecycleReads),
						setSession: (value) => Ref.set(session, value),
						setLifecycleActive: (value) => Ref.set(lifecycleActive, value),
					}),
				),
			);
		}),
	);

const sessionRecord = (now: number, overrides: Partial<SessionRecord> = {}): SessionRecord => ({
	id: "session-1",
	disabledAt: null,
	userId: "user-1",
	expiresAt: DateTime.toDate(DateTime.makeUnsafe(now + 60_000)),
	bootstrapCompletedAt: DateTime.toDate(DateTime.makeUnsafe(now)),
	impersonationExpiresAt: DateTime.toDate(DateTime.makeUnsafe(now + 30_000)),
	...overrides,
});

layer(makeLayer())((test) => {
	test.effect(
		"rejects missing, disabled, initializing, mismatched, and lifecycle-blocked sessions",
		() =>
			Effect.gen(function* () {
				const service = yield* ImpersonationSessions;
				const state = yield* ImpersonationSessionState;
				const now = yield* Clock.currentTimeMillis;
				const active = sessionRecord(now);

				yield* state.setSession(null);
				expect(yield* service.getActive("session-1", "user-1")).toBeNull();

				yield* state.setSession(
					sessionRecord(now, { disabledAt: DateTime.toDate(DateTime.makeUnsafe(now)) }),
				);
				expect(yield* service.getActive("session-1", "user-1")).toBeNull();

				yield* state.setSession(sessionRecord(now, { bootstrapCompletedAt: null }));
				expect(yield* service.getActive("session-1", "user-1")).toBeNull();

				yield* state.setSession(active);
				expect(yield* service.getActive("session-1", "other-user")).toBeNull();

				yield* state.setLifecycleActive(true);
				expect(yield* service.getActive("session-1", "user-1")).toBeNull();
				expect(yield* state.sessionReads).toEqual([
					"session-1",
					"session-1",
					"session-1",
					"session-1",
					"session-1",
				]);
				expect(yield* state.lifecycleReads).toEqual([UserId.make("user-1")]);
			}),
	);
});

layer(makeLayer())((test) => {
	test.effect("expires at the session and impersonation lifetime boundaries", () =>
		Effect.gen(function* () {
			const service = yield* ImpersonationSessions;
			const state = yield* ImpersonationSessionState;
			const now = yield* Clock.currentTimeMillis;

			yield* state.setSession(
				sessionRecord(now, {
					expiresAt: DateTime.toDate(DateTime.makeUnsafe(now + 1_000)),
					impersonationExpiresAt: DateTime.toDate(DateTime.makeUnsafe(now + 2_000)),
				}),
			);
			expect(yield* service.getActive("session-1", "user-1")).toEqual({ expiresAt: now + 2_000 });
			yield* TestClock.adjust("1 second");
			expect(yield* service.getActive("session-1", "user-1")).toBeNull();

			const currentTime = yield* Clock.currentTimeMillis;
			yield* state.setSession(
				sessionRecord(currentTime, {
					expiresAt: DateTime.toDate(DateTime.makeUnsafe(currentTime + 2_000)),
					impersonationExpiresAt: DateTime.toDate(DateTime.makeUnsafe(currentTime + 1_000)),
				}),
			);
			expect(yield* service.getActive("session-1", "user-1")).toEqual({
				expiresAt: currentTime + 1_000,
			});
			yield* TestClock.adjust("1 second");
			expect(yield* service.getActive("session-1", "user-1")).toBeNull();
		}),
	);
});
