import type { UserId } from "@ryot-app/contract/schema/brands";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Effect } from "effect";

import { SandboxExecutor } from "./executor";
import type { SandboxPrincipal } from "./principal";

// The backend computes the same digest in SQL: the sorted script hashes, comma-joined.
export const scriptsDigestOf = (compiledHashes: Readonly<Record<string, string>>) =>
	sha256Hex(Object.values(compiledHashes).sort().join(","));

export const makeUserPluginRevision = (input: {
	readonly ownerId: null | UserId;
	readonly compiledHashes: Readonly<Record<string, string>>;
}): NonNullable<SandboxPrincipal["pluginRevision"]> => ({
	scope: "user",
	ownerId: input.ownerId,
	scriptsDigest: scriptsDigestOf(input.compiledHashes),
});

export const stubRuntimeSandboxExecutor = (run: SandboxExecutor["Service"]["run"]) =>
	SandboxExecutor.of({
		run,
		completeRecovery: () => Effect.void,
		reserve: () => Effect.succeed({ enter: () => Effect.as(Effect.void, undefined) }),
	});
