import { SandboxRunError } from "@ryot-app/contract/errors";
import { SandboxExecutionAuthority } from "@ryot-app/sandbox/host/authority";
import type { SandboxPrincipal } from "@ryot-app/sandbox/host/principal";
import { stableStringify } from "@ryot-app/ts-utils/json";
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
		const resolve = Effect.fn("SandboxExecutionAuthority.resolve")(function* (
			principal: SandboxPrincipal,
		) {
			const validated = yield* Schema.decodeUnknownEffect(ScriptExecutionPrincipal)(principal).pipe(
				Effect.mapError(invalidPin),
			);
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
			if (stableStringify(stored) !== stableStringify(validated)) {
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
