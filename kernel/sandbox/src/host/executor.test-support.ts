import {
	PluginConfigRevisionId,
	PluginId,
	PluginPackageId,
	PluginRevisionId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import type { ScriptPluginRevision } from "../protocol/principal";
import { SandboxExecutor } from "./executor";

export const makeUserPluginRevision = (input: {
	readonly slug: string;
	readonly ownerId: UserId | null;
	readonly compiledHashes: Readonly<Record<string, string>>;
}): ScriptPluginRevision => ({
	scope: "user",
	workflowScripts: {},
	ownerId: input.ownerId,
	userBootstrapScriptSlugs: [],
	id: PluginId.make(input.slug),
	compiledHashes: input.compiledHashes,
	packageId: PluginPackageId.make("test/fixture"),
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

export const stubRuntimeSandboxExecutor = (run: SandboxExecutor["Service"]["run"]) =>
	SandboxExecutor.of({
		run,
		completeRecovery: () => Effect.void,
		reserve: () => Effect.succeed({ enter: () => Effect.as(Effect.void, undefined) }),
	});
