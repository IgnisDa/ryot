import type { UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { SandboxExecutor } from "./executor";
import type { SandboxPrincipal } from "./principal";

export const makeUserPluginRevision = (input: {
	readonly ownerId: null | UserId;
	readonly compiledHashes: Readonly<Record<string, string>>;
}): NonNullable<SandboxPrincipal["pluginRevision"]> => ({
	scope: "user",
	ownerId: input.ownerId,
	compiledHashes: input.compiledHashes,
});

export const stubRuntimeSandboxExecutor = (run: SandboxExecutor["Service"]["run"]) =>
	SandboxExecutor.of({
		run,
		completeRecovery: () => Effect.void,
		reserve: () => Effect.succeed({ enter: () => Effect.as(Effect.void, undefined) }),
	});
