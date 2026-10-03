import { SandboxRunError } from "@ryot-app/contract/errors";
import { Context, Effect, Layer, Schema } from "effect";

import { SandboxCrashStore } from "../sandbox-crash-store";
import type { SandboxExecutionPrincipal } from "./execution-principal";

const encodeHashes = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));
const hashPattern = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();
const unavailable = () =>
	new SandboxRunError({
		kind: "resource-unavailable",
		message: "Sandbox crash protection unavailable",
	});

const identitiesFor = Effect.fn("SandboxSidecarQuarantine.identities")(function* (
	principal: SandboxExecutionPrincipal,
	trust: "system" | "user",
) {
	const subject = principal.subject;
	let userId = subject.type === "user" ? subject.userId : null;
	if (subject.type === "automation-run") {
		userId = subject.executionUserId;
	}
	if (trust === "system") {
		if (principal.pluginRevision?.scope === "user") {
			return yield* unavailable();
		}
		return userId === null
			? [`system:script:${principal.scriptId}`]
			: [`system:user:${userId}:jobs`, `system:user:${userId}:script:${principal.scriptId}`];
	}
	const uploader =
		principal.pluginRevision === null
			? principal.standaloneUploaderId
			: principal.pluginRevision.ownerId;
	if (uploader === undefined) {
		return yield* new SandboxRunError({
			kind: "resource-unavailable",
			message: "Sandbox standalone upload has no pinned uploader identity",
		});
	}
	const hashes = principal.pluginRevision
		? Object.values(principal.pluginRevision.compiledHashes).sort()
		: [principal.contentHash];
	if (
		uploader === null ||
		principal.pluginRevision?.scope === "system" ||
		!hashes.includes(principal.contentHash) ||
		hashes.some((hash) => !hashPattern.test(hash))
	) {
		return yield* unavailable();
	}
	const bytes = encoder.encode(encodeHashes(hashes));
	const digest = yield* Effect.tryPromise(() => crypto.subtle.digest("SHA-256", bytes)).pipe(
		Effect.mapError(unavailable),
	);
	const content = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	return [`user:uploader:${uploader}`, `user:content:${content}`];
});

export class SandboxSidecarQuarantine extends Context.Service<SandboxSidecarQuarantine>()(
	"SandboxSidecarQuarantine",
	{
		make: Effect.gen(function* () {
			const store = yield* SandboxCrashStore;
			const open = Effect.fn("SandboxSidecarQuarantine.open")(function* (
				principal: SandboxExecutionPrincipal,
				trust: "system" | "user",
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
