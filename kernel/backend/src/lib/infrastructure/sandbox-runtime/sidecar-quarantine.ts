import { SandboxRunError } from "@ryot-app/contract/errors";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Context, Effect, Layer, Schema } from "effect";

import { SandboxCrashStore } from "../sandbox-crash-store";
import {
	sandboxSubjectUserId,
	type SandboxExecutionPrincipal,
	type SandboxTrust,
} from "./execution-principal";

const encodeHashes = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));
const hashPattern = /^[0-9a-f]{64}$/;
const unavailable = () =>
	new SandboxRunError({
		kind: "resource-unavailable",
		message: "Sandbox crash protection unavailable",
	});

const identitiesFor = Effect.fn("SandboxSidecarQuarantine.identities")(function* (
	principal: SandboxExecutionPrincipal,
	trust: typeof SandboxTrust.Type,
) {
	const userId = sandboxSubjectUserId(principal.subject);
	if (trust === "system") {
		if (principal.pluginRevision?.scope === "user") {
			return yield* unavailable();
		}
		return userId === null
			? [`system:script:${principal.scriptId}`]
			: [`system:user:${userId}:jobs`, `system:user:${userId}:script:${principal.scriptId}`];
	}
	const revision = principal.pluginRevision;
	if (revision === null) {
		return yield* unavailable();
	}
	const hashes = Object.values(revision.compiledHashes).sort();
	if (
		revision.ownerId === null ||
		revision.scope === "system" ||
		!hashes.includes(principal.contentHash) ||
		hashes.some((hash) => !hashPattern.test(hash))
	) {
		return yield* unavailable();
	}
	const content = sha256Hex(encodeHashes(hashes));
	return [`user:owner:${revision.ownerId}`, `user:content:${content}`];
});

export class SandboxSidecarQuarantine extends Context.Service<SandboxSidecarQuarantine>()(
	"SandboxSidecarQuarantine",
	{
		make: Effect.gen(function* () {
			const store = yield* SandboxCrashStore;
			const open = Effect.fn("SandboxSidecarQuarantine.open")(function* (
				principal: SandboxExecutionPrincipal,
				trust: typeof SandboxTrust.Type,
			) {
				const identities = yield* identitiesFor(principal, trust);
				const owner = crypto.randomUUID();
				const result = yield* store.acquire(identities, owner).pipe(Effect.mapError(unavailable));
				if (result !== "allowed" && result !== "probation") {
					return yield* new SandboxRunError({
						kind: "resource-unavailable",
						message: "Sandbox execution is quarantined or awaiting exclusive probation",
					});
				}
				if (result === "probation") {
					yield* Effect.addFinalizer(() =>
						store
							.release(identities, owner)
							.pipe(
								Effect.catch(() => Effect.logWarning("Sandbox probation lease release failed")),
							),
					);
				}
				return {
					identities,
					probation: result === "probation",
					recordCrash: store
						.strike(identities, crypto.randomUUID())
						.pipe(Effect.mapError(unavailable), Effect.asVoid),
					survived:
						result === "probation"
							? store.survived(identities, owner).pipe(Effect.mapError(unavailable), Effect.asVoid)
							: Effect.void,
				};
			});
			return { open };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(SandboxCrashStore.layer),
	);
}
