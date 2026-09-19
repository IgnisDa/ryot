import { SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import type { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { utf8ByteLength } from "@ryot-app/sandbox-compiler/limits";
import { SANDBOX_COMPILED_FORMAT } from "@ryot-app/sandbox-compiler/protocol";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Cache, Context, Duration, Effect, Exit, Layer } from "effect";

import type { SandboxExecutionPrincipal } from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";
import type { SandboxRunInput } from "#lib/infrastructure/sandbox-runtime/shared";

import { SandboxRepository } from "./repository";

class SandboxCompiledArtifactScriptId extends Context.Service<
	SandboxCompiledArtifactScriptId,
	SandboxScriptId
>()("SandboxCompiledArtifactScriptId") {}

type CompiledArtifact = Pick<SandboxRunInput, "compiledCode" | "compiledFormat">;

const missingArtifact = () =>
	new SandboxRunError({
		kind: "missing-artifact",
		message: "Sandbox compiled artifact is missing or invalid",
	});

export class SandboxCompiledArtifacts extends Context.Service<
	SandboxCompiledArtifacts,
	{
		readonly get: (
			principal: Pick<SandboxExecutionPrincipal, "scriptId" | "contentHash">,
		) => Effect.Effect<CompiledArtifact, SandboxRunError>;
	}
>()("SandboxCompiledArtifacts", {
	make: Effect.gen(function* () {
		const repository = yield* SandboxRepository;
		const cache = yield* Cache.makeWith(
			Effect.fn("SandboxCompiledArtifacts.lookup")(function* (contentHash: string) {
				const scriptId = yield* SandboxCompiledArtifactScriptId;
				const script = yield* repository
					.getScript(scriptId)
					.pipe(
						Effect.mapError(
							(error) =>
								new SandboxRunError({ kind: "infrastructure", message: unknownToMessage(error) }),
						),
					);
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
		const get = Effect.fn("SandboxCompiledArtifacts.get")(function* (
			principal: Pick<SandboxExecutionPrincipal, "scriptId" | "contentHash">,
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
