import { SandboxRunError } from "@ryot-app/contract/errors";
import { SandboxExecutionAuthority } from "@ryot-app/sandbox/host/authority";
import type { SandboxPrincipal } from "@ryot-app/sandbox/host/principal";
import { jsonValueEquals } from "@ryot-app/ts-utils/json";
import { Effect, Layer, Schema } from "effect";

import { SandboxRepository } from "../registry/repository";
import { ScriptExecutionPrincipal } from "./principal";

const invalidPin = (error?: unknown) =>
	error instanceof SandboxRunError
		? error
		: new SandboxRunError({
				kind: "missing-artifact",
				message: "Sandbox execution pin does not match its stored authority",
			});

export const SandboxExecutionAuthorityLive = Layer.effect(
	SandboxExecutionAuthority,
	Effect.gen(function* () {
		const repository = yield* SandboxRepository;
		// Decoding is pure, and a run passes the same principal object to each of its host calls.
		const decoded = new WeakMap<SandboxPrincipal, ScriptExecutionPrincipal>();
		const decode = (principal: SandboxPrincipal) => {
			const known = decoded.get(principal);
			return known
				? Effect.succeed(known)
				: Schema.decodeUnknownEffect(ScriptExecutionPrincipal)(principal).pipe(
						Effect.tap((validated) => Effect.sync(() => decoded.set(principal, validated))),
						Effect.mapError(invalidPin),
					);
		};
		const resolve = Effect.fn("SandboxExecutionAuthority.resolve")(function* (
			principal: SandboxPrincipal,
		) {
			const validated = yield* decode(principal);
			const pinned = yield* repository
				.getScriptPin(
					validated.scriptId,
					validated.pluginRevision ?? undefined,
					validated.subject,
					validated.initialization,
				)
				.pipe(Effect.mapError(invalidPin));
			if (pinned === null) {
				return yield* invalidPin();
			}
			const stored = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({
				...pinned,
				subject: validated.subject,
			}).pipe(Effect.mapError(invalidPin));
			if (!jsonValueEquals(stored, validated)) {
				return yield* invalidPin();
			}
			if (validated.pluginRevision !== null) {
				return validated.pluginRevision.scope;
			}
			if (validated.kernelScript === true) {
				return "system";
			}
			return yield* invalidPin();
		});
		return { resolve };
	}),
);
