import {
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Path } from "effect";

import type { SandboxPluginRevision } from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { SandboxService } from "#lib/infrastructure/sandbox-runtime/service";

export const sandboxRuntimeDirectory = Effect.gen(function* () {
	const path = yield* Path.Path;
	const source = yield* path.fromFileUrl(new URL(import.meta.url));
	return path.resolve(path.dirname(source), "../../../../sandboxd/dist");
});

export const makeUserPluginRevision = (input: {
	readonly slug: string;
	readonly ownerId: UserId | null;
	readonly compiledHashes: Readonly<Record<string, string>>;
}): SandboxPluginRevision => ({
	scope: "user",
	slug: input.slug,
	workflowScripts: {},
	ownerId: input.ownerId,
	userBootstrapScriptSlugs: [],
	id: PluginId.make(input.slug),
	compiledHashes: input.compiledHashes,
	configSchema: { fields: {}, unknownKeys: "strict" },
	revisionId: PluginRevisionId.make(`${input.slug}-revision`),
	configRevisionId: PluginConfigRevisionId.make(`${input.slug}-config`),
	schemaScope: { eventSchemas: [], entitySchemaSlugs: [], relationshipSchemaSlugs: [] },
});

export const stubRuntimeSandboxService = (run: SandboxService["Service"]["run"]) =>
	SandboxService.of({
		run,
		completeRecovery: () => Effect.void,
		reserve: () => Effect.succeed({ enter: () => Effect.as(Effect.void, undefined) }),
	});
