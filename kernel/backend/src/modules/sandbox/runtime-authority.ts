import { SandboxRunError } from "@ryot-app/contract/errors";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Layer, Schema } from "effect";

import {
	SandboxExecutionAuthority,
	SandboxExecutionPrincipal,
} from "#lib/infrastructure/sandbox-runtime/execution-principal";

import { SandboxRepository } from "./repository";

const invalidPin = () =>
	new SandboxRunError({
		kind: "missing-artifact",
		message: "Sandbox execution pin does not match its stored authority",
	});

export const SandboxExecutionAuthorityLive = Layer.effect(
	SandboxExecutionAuthority,
	Effect.gen(function* () {
		const repository = yield* SandboxRepository;
		const resolve = Effect.fn("SandboxExecutionAuthority.resolve")(function* (
			principal: SandboxExecutionPrincipal,
		) {
			const validated = yield* Schema.decodeEffect(SandboxExecutionPrincipal)(principal).pipe(
				Effect.mapError(invalidPin),
			);
			const pinned = yield* repository
				.getScriptPin(validated.scriptId, validated.pluginRevision ?? undefined)
				.pipe(Effect.mapError(invalidPin));
			if (pinned === null) {
				return yield* invalidPin();
			}
			const stored = yield* Schema.decodeEffect(SandboxExecutionPrincipal)({
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
