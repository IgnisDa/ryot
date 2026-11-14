import { Clock, Context, Effect, Layer, Schema } from "effect";

/** The new value of a key, kept for `ttlMs` when given; `null` removes the key. */
export type SandboxStateWrite = null | { readonly value: string; readonly ttlMs?: number };

export type SandboxStateUpdate<A> = {
	readonly result: A;
	readonly writes: ReadonlyMap<string, SandboxStateWrite>;
};

type SandboxStateApply<A> = (
	current: ReadonlyMap<string, string>,
	nowMs: number,
) => SandboxStateUpdate<A>;

export class SandboxStateStoreUnavailable extends Schema.TaggedError<
	SandboxStateStoreUnavailable,
	{ readonly brand: unique symbol }
>()("SandboxStateStoreUnavailable", {}) {}

/** Small values shared by every process on this deployment, which outlive any one of them. */
export class SandboxStateStore extends Context.Service<
	SandboxStateStore,
	{
		readonly read: (
			keys: ReadonlyArray<string>,
		) => Effect.Effect<ReadonlyMap<string, string>, SandboxStateStoreUnavailable>;
		/** Runs `apply` over the current values with no other update of these keys in between. */
		readonly update: <A>(
			keys: ReadonlyArray<string>,
			apply: SandboxStateApply<A>,
		) => Effect.Effect<A, SandboxStateStoreUnavailable>;
	}
>()("@ryot-app/sandbox/host/state-store/SandboxStateStore") {
	static readonly memoryLayer = Layer.sync(this, () => {
		const entries = new Map<string, { readonly value: string; readonly expiresAtMs?: number }>();
		const live = (keys: ReadonlyArray<string>, nowMs: number) =>
			new Map(
				keys.flatMap((key) => {
					const entry = entries.get(key);
					return entry === undefined ||
						(entry.expiresAtMs !== undefined && entry.expiresAtMs <= nowMs)
						? []
						: [[key, entry.value] as const];
				}),
			);
		return {
			read: (keys) => Effect.map(Clock.currentTimeMillis, (nowMs) => live(keys, nowMs)),
			update: (keys, apply) =>
				Effect.map(Clock.currentTimeMillis, (nowMs) => {
					const { result, writes } = apply(live(keys, nowMs), nowMs);
					for (const [key, write] of writes) {
						if (write === null) {
							entries.delete(key);
						} else {
							entries.set(key, {
								value: write.value,
								...(write.ttlMs === undefined ? {} : { expiresAtMs: nowMs + write.ttlMs }),
							});
						}
					}
					return result;
				}),
		};
	});
}
