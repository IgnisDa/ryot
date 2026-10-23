import { SandboxRunError } from "@ryot-app/contract/errors";
import type { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { utf8ByteLength } from "@ryot-app/plugin-backend-compiler/limits";
import { SANDBOX_COMPILED_FORMAT } from "@ryot-app/plugin-backend-compiler/protocol";
import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Cache, Context, Duration, Effect, Exit, Layer } from "effect";

import type { ScriptRunInput } from "#modules/scripts/authorization/capabilities";
import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";

import { infrastructureRunError } from "../executions/run-error";
import { SandboxRepository } from "./repository";

class SandboxCompiledArtifactScriptId extends Context.Service<
	SandboxCompiledArtifactScriptId,
	SandboxScriptId
>()("SandboxCompiledArtifactScriptId") {}

type CompiledArtifact = Pick<ScriptRunInput, "compiledCode" | "compiledFormat">;

const missingArtifact = () =>
	new SandboxRunError({
		kind: "missing-artifact",
		message: "Sandbox compiled artifact is missing or invalid",
	});

export class ExecutableArtifacts extends Context.Service<
	ExecutableArtifacts,
	{
		readonly get: (
			principal: Pick<ScriptExecutionPrincipal, "scriptId" | "contentHash">,
		) => Effect.Effect<CompiledArtifact, SandboxRunError>;
	}
>()("ExecutableArtifacts", {
	make: Effect.gen(function* () {
		const repository = yield* SandboxRepository;
		const cache = yield* Cache.makeWith(
			Effect.fn("ExecutableArtifacts.lookup")(function* (contentHash: string) {
				const scriptId = yield* SandboxCompiledArtifactScriptId;
				const script = yield* repository
					.getScript(scriptId)
					.pipe(Effect.mapError(infrastructureRunError));
				if (
					!script ||
					script.contentHash !== contentHash ||
					script.compiledFormat !== SANDBOX_COMPILED_FORMAT ||
					utf8ByteLength(script.compiledCode) > SANDBOX_LIMITS.compiler.javascriptBytes ||
					sha256Hex(script.compiledCode) !== contentHash
				) {
					return yield* missingArtifact();
				}
				return { compiledCode: script.compiledCode, compiledFormat: script.compiledFormat };
			}),
			{
				capacity: 16,
				requireServicesAt: "lookup",
				timeToLive: (exit) => (Exit.isFailure(exit) ? Duration.zero : Duration.infinity),
			},
		);
		const get = Effect.fn("ExecutableArtifacts.get")(function* (
			principal: Pick<ScriptExecutionPrincipal, "scriptId" | "contentHash">,
		) {
			return yield* Cache.get(cache, principal.contentHash).pipe(
				Effect.provideService(SandboxCompiledArtifactScriptId, principal.scriptId),
			);
		});
		return { get };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(SandboxRepository.layer),
	);
}
