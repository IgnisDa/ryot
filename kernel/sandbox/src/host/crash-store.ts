import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Option, Schema } from "effect";

import { SandboxStateStore, type SandboxStateWrite } from "./state-store";

export class SandboxCrashStoreError extends Schema.TaggedError<
	SandboxCrashStoreError,
	{ readonly brand: unique symbol }
>()("SandboxCrashStoreError", { message: Schema.String }) {}

const crashStoreUnavailable = () =>
	new SandboxCrashStoreError({ message: "Crash store unavailable" });

const identitySchema = Schema.Array(Schema.String.check(Schema.isNonEmpty())).check(
	Schema.isMinLength(1),
	Schema.isMaxLength(2),
);
const decodeIdentities = Schema.decodeUnknownEffect(identitySchema);

const PROBATION_LEASE_MS = 330_000;
export const CRASH_WINDOW_MS = 600_000;
export const QUARANTINE_MS = 3_600_000;
const CRASH_STRIKE_LIMIT = 3;

const Protection = Schema.Struct({
	probation: Schema.Boolean,
	blockedUntilMs: Schema.Finite,
	strikes: Schema.Array(Schema.Struct({ atMs: Schema.Finite, event: Schema.String })),
	lease: Schema.NullOr(Schema.Struct({ owner: Schema.String, untilMs: Schema.Finite })),
});
type Protection = typeof Protection.Type;
const decodeProtection = Schema.decodeOption(Schema.fromJsonString(Protection));

const emptyProtection: Protection = {
	lease: null,
	strikes: [],
	probation: false,
	blockedUntilMs: 0,
};

export const sandboxProtectionKey = (identity: string) =>
	`sandbox:protection:${encodeURIComponent(identity)}`;

const leaseOf = (protection: Protection, nowMs: number) =>
	protection.lease !== null && protection.lease.untilMs > nowMs ? protection.lease : null;

const protectionWrite = (protection: Protection, nowMs: number): SandboxStateWrite => {
	const lease = leaseOf(protection, nowMs);
	const strikes = protection.strikes.filter(({ atMs }) => atMs > nowMs - CRASH_WINDOW_MS);
	const blocked = protection.blockedUntilMs > nowMs;
	if (!(protection.probation || blocked || lease !== null || strikes.length > 0)) {
		return null;
	}
	const value = stableStringify({ ...protection, lease, strikes });
	return protection.probation
		? { value }
		: {
				value,
				ttlMs: Math.max(
					protection.blockedUntilMs - nowMs,
					lease === null ? 0 : lease.untilMs - nowMs,
					strikes.length === 0
						? 0
						: Math.max(...strikes.map(({ atMs }) => atMs)) + CRASH_WINDOW_MS - nowMs,
				),
			};
};

const protectionOf = (current: ReadonlyMap<string, string>, key: string) => {
	const stored = current.get(key);
	return stored === undefined
		? emptyProtection
		: Option.getOrElse(decodeProtection(stored), () => emptyProtection);
};

const bounded = <A>(effect: Effect.Effect<A, unknown>) =>
	effect.pipe(
		Effect.timeoutOrElse({
			duration: "2 seconds",
			orElse: () => Effect.fail(crashStoreUnavailable()),
		}),
		Effect.mapError(crashStoreUnavailable),
	);

export class SandboxCrashStore extends Context.Service<SandboxCrashStore>()(
	"@ryot-app/sandbox/host/crash-store/SandboxCrashStore",
	{
		make: Effect.gen(function* () {
			const store = yield* SandboxStateStore;
			const validated = Effect.fnUntraced(function* (
				identities: ReadonlyArray<string>,
				argument: string,
			) {
				const decoded = yield* decodeIdentities(identities).pipe(
					Effect.mapError(() => new SandboxCrashStoreError({ message: "Invalid crash identity" })),
				);
				if (new Set(decoded).size !== decoded.length || argument.length === 0) {
					return yield* new SandboxCrashStoreError({ message: "Invalid crash ownership" });
				}
				return decoded.map((identity) => sandboxProtectionKey(identity));
			});

			const strike = Effect.fn("SandboxCrashStore.strike")(function* (
				identities: ReadonlyArray<string>,
				event: string,
			) {
				const keys = yield* validated(identities, event);
				return yield* bounded(
					store.update(keys, (current, nowMs) => ({
						result: "recorded" as const,
						writes: new Map(
							keys.map((key) => {
								const protection = protectionOf(current, key);
								const live = protection.strikes.filter(
									({ atMs }) => atMs > nowMs - CRASH_WINDOW_MS,
								);
								const strikes = live.some((entry) => entry.event === event)
									? live
									: [...live, { event, atMs: nowMs }];
								const quarantined =
									strikes.length >= CRASH_STRIKE_LIMIT || leaseOf(protection, nowMs) !== null;
								return [
									key,
									protectionWrite(
										quarantined
											? {
													...protection,
													strikes,
													lease: null,
													probation: true,
													blockedUntilMs: nowMs + QUARANTINE_MS,
												}
											: { ...protection, strikes },
										nowMs,
									),
								];
							}),
						),
					})),
				);
			});

			const acquire = Effect.fn("SandboxCrashStore.acquire")(function* (
				identities: ReadonlyArray<string>,
				owner: string,
			) {
				const keys = yield* validated(identities, owner);
				// Nearly every run finds nothing, and must not pay for a transaction to learn it.
				if ((yield* bounded(store.read(keys))).size === 0) {
					return "allowed" as const;
				}
				return yield* bounded(
					store.update(keys, (current, nowMs) => {
						const protections = keys.map((key) => [key, protectionOf(current, key)] as const);
						if (
							protections.some(
								([, protection]) =>
									protection.blockedUntilMs > nowMs || leaseOf(protection, nowMs) !== null,
							)
						) {
							return { writes: new Map(), result: "blocked" as const };
						}
						if (!protections.some(([, protection]) => protection.probation)) {
							return { writes: new Map(), result: "allowed" as const };
						}
						return {
							result: "probation" as const,
							writes: new Map(
								protections.map(([key, protection]) => [
									key,
									protectionWrite(
										{
											...protection,
											probation: true,
											lease: { owner, untilMs: nowMs + PROBATION_LEASE_MS },
										},
										nowMs,
									),
								]),
							),
						};
					}),
				);
			});

			const settle = (
				identities: ReadonlyArray<string>,
				owner: string,
				operation: "release" | "survived",
			) =>
				Effect.gen(function* () {
					const keys = yield* validated(identities, owner);
					return yield* bounded(
						store.update(keys, (current, nowMs) => {
							const protections = keys.map((key) => [key, protectionOf(current, key)] as const);
							const owned = protections.every(
								([, protection]) => leaseOf(protection, nowMs)?.owner === owner,
							);
							return {
								result: owned ? ("recorded" as const) : ("stale" as const),
								writes: new Map(
									protections.flatMap(([key, protection]) =>
										leaseOf(protection, nowMs)?.owner === owner
											? [
													[
														key,
														protectionWrite(
															owned && operation === "survived"
																? { ...protection, lease: null, strikes: [], probation: false }
																: { ...protection, lease: null },
															nowMs,
														),
													] as const,
												]
											: [],
									),
								),
							};
						}),
					);
				});

			return {
				strike,
				acquire,
				release: (identities: ReadonlyArray<string>, owner: string) =>
					settle(identities, owner, "release"),
				survived: (identities: ReadonlyArray<string>, owner: string) =>
					settle(identities, owner, "survived"),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
