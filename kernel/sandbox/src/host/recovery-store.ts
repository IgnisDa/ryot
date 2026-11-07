import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Option, Schema } from "effect";

import { SandboxStateStore, type SandboxStateUpdate } from "./state-store";

export class SandboxRecoveryStoreError extends Schema.TaggedError<
	SandboxRecoveryStoreError,
	{ readonly brand: unique symbol }
>()("SandboxRecoveryStoreError", { message: Schema.String }) {}

const recoveryStoreUnavailable = () =>
	new SandboxRecoveryStoreError({ message: "Recovery store unavailable" });

const RECOVERY_LIMIT = 3;
// An execution clears its state when it settles; this only collects one that never did.
const RECOVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const nonEmptyStringSchema = Schema.String.check(Schema.isNonEmpty());
export const SandboxRecoveryIdentity = Schema.Struct({
	instance: nonEmptyStringSchema,
	executionId: nonEmptyStringSchema,
	pinHash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
});
export type SandboxRecoveryIdentity = typeof SandboxRecoveryIdentity.Type;
const decodeIdentity = Schema.decodeUnknownEffect(SandboxRecoveryIdentity);
const decodeNonEmptyString = Schema.decodeUnknownEffect(nonEmptyStringSchema);

const RecoveryRow = Schema.Struct({
	pinHash: Schema.String,
	instance: Schema.String,
	suspended: Schema.Boolean,
	events: Schema.Array(Schema.String),
	healthyEpoch: Schema.NullOr(Schema.String),
	latestSuspendedEvent: Schema.NullOr(Schema.String),
});
type RecoveryRow = typeof RecoveryRow.Type;
const decodeRow = Schema.decodeOption(Schema.fromJsonString(RecoveryRow));

export const sandboxRecoveryKey = (executionId: string) =>
	`sandbox:recovery:${encodeURIComponent(executionId)}`;

const stateOf = (row: null | RecoveryRow) => ({
	suspended: row?.suspended ?? false,
	recoveries: row?.events.length ?? 0,
});

type Operation = "read" | "clear" | "resume" | "collateral";
type Outcome =
	| { readonly _tag: "corrupt" }
	| { readonly _tag: "mismatch" }
	| { readonly _tag: "state"; readonly state: ReturnType<typeof stateOf> };

const apply = (
	operation: Exclude<Operation, "read">,
	row: RecoveryRow,
	argument: string | undefined,
): RecoveryRow => {
	if (operation === "resume" && row.healthyEpoch !== argument) {
		return { ...row, suspended: false, healthyEpoch: argument ?? null };
	}
	if (operation !== "collateral" || argument === undefined) {
		return row;
	}
	if (row.latestSuspendedEvent === argument || row.events.includes(argument)) {
		return row;
	}
	return row.events.length < RECOVERY_LIMIT
		? { ...row, events: [...row.events, argument] }
		: { ...row, suspended: true, latestSuspendedEvent: argument };
};

const bounded = <A>(effect: Effect.Effect<A, unknown>) =>
	effect.pipe(
		Effect.timeoutOrElse({
			duration: "2 seconds",
			orElse: () => Effect.fail(recoveryStoreUnavailable()),
		}),
		Effect.mapError(recoveryStoreUnavailable),
	);

const inspect = (
	stored: string | undefined,
	identity: SandboxRecoveryIdentity,
): Outcome & { readonly row?: RecoveryRow } => {
	if (stored === undefined) {
		return { _tag: "state", state: stateOf(null) };
	}
	const decoded = decodeRow(stored);
	if (Option.isNone(decoded)) {
		return { _tag: "corrupt" };
	}
	return decoded.value.instance === identity.instance && decoded.value.pinHash === identity.pinHash
		? { _tag: "state", row: decoded.value, state: stateOf(decoded.value) }
		: { _tag: "mismatch" };
};

export class SandboxRecoveryStore extends Context.Service<SandboxRecoveryStore>()(
	"@ryot-app/sandbox/host/recovery-store/SandboxRecoveryStore",
	{
		make: Effect.gen(function* () {
			const store = yield* SandboxStateStore;
			const settled = Effect.fnUntraced(function* (outcome: Outcome) {
				if (outcome._tag === "mismatch") {
					return yield* new SandboxRecoveryStoreError({ message: "Recovery identity mismatch" });
				}
				if (outcome._tag === "corrupt") {
					return yield* new SandboxRecoveryStoreError({ message: "Recovery store is corrupt" });
				}
				return outcome.state;
			});
			const execute = Effect.fn("SandboxRecoveryStore.execute")(function* (
				operation: Operation,
				input: SandboxRecoveryIdentity,
				argument?: string,
			) {
				const identity = yield* decodeIdentity(input).pipe(
					Effect.mapError(
						() => new SandboxRecoveryStoreError({ message: "Invalid recovery identity" }),
					),
				);
				const validatedArgument =
					operation === "collateral" || operation === "resume"
						? yield* decodeNonEmptyString(argument).pipe(
								Effect.mapError(
									() =>
										new SandboxRecoveryStoreError({
											message: `Invalid recovery ${operation === "collateral" ? "event" : "epoch"}`,
										}),
								),
							)
						: undefined;
				const key = sandboxRecoveryKey(identity.executionId);
				if (operation === "read") {
					const current = yield* bounded(store.read([key]));
					return yield* settled(inspect(current.get(key), identity));
				}
				const outcome = yield* bounded(
					store.update([key], (current): SandboxStateUpdate<Outcome> => {
						const inspected = inspect(current.get(key), identity);
						if (inspected._tag !== "state") {
							return { result: inspected, writes: new Map() };
						}
						if (operation === "clear") {
							return {
								writes: new Map([[key, null]]),
								result: { _tag: "state", state: stateOf(null) },
							};
						}
						const row = apply(
							operation,
							inspected.row ?? {
								events: [],
								suspended: false,
								healthyEpoch: null,
								pinHash: identity.pinHash,
								latestSuspendedEvent: null,
								instance: identity.instance,
							},
							validatedArgument,
						);
						return {
							result: { _tag: "state", state: stateOf(row) },
							writes: new Map([
								[key, { value: stableStringify(row), ttlMs: RECOVERY_RETENTION_MS }],
							]),
						};
					}),
				);
				return yield* settled(outcome);
			});
			return {
				read: (identity: SandboxRecoveryIdentity) => execute("read", identity),
				clear: (identity: SandboxRecoveryIdentity) => execute("clear", identity),
				collateral: (identity: SandboxRecoveryIdentity, eventId: string) =>
					execute("collateral", identity, eventId),
				resume: (identity: SandboxRecoveryIdentity, healthyEpoch: string) =>
					execute("resume", identity, healthyEpoch),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
