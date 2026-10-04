import {
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import type { SandboxPluginRevision } from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { SandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { fixtureManifest } from "#modules/plugins/test-support";

export const makeUserPluginRevision = (input: {
	readonly slug: string;
	readonly ownerId: UserId | null;
	readonly compiledHashes: Readonly<Record<string, string>>;
}): SandboxPluginRevision => ({
	scope: "user",
	workflowScripts: {},
	ownerId: input.ownerId,
	userBootstrapScriptSlugs: [],
	id: PluginId.make(input.slug),
	compiledHashes: input.compiledHashes,
	packageId: fixtureManifest().metadata.packageId,
	configSchema: { fields: {}, unknownKeys: "strict" },
	revisionId: PluginRevisionId.make(`${input.slug}-revision`),
	configRevisionId: PluginConfigRevisionId.make(`${input.slug}-config`),
	schemaScope: {
		eventSchemas: [],
		entitySchemaSlugs: [],
		signalSchemaSlugs: [],
		relationshipSchemaSlugs: [],
	},
});

export const stubRuntimeSandboxService = (run: SandboxService["Service"]["run"]) =>
	SandboxService.of({
		run,
		completeRecovery: () => Effect.void,
		reserve: () => Effect.succeed({ enter: () => Effect.as(Effect.void, undefined) }),
	});
