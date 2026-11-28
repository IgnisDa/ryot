import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

const emptyManifest = (packageId: PluginPackageId): PluginManifest => ({
	crons: [],
	hooks: [],
	scripts: [],
	workflows: [],
	providers: [],
	operations: [],
	savedViews: [],
	entitySchemas: [],
	signalSchemas: [],
	userBootstrap: [],
	importSources: [],
	httpRateLimits: [],
	calendarSources: [],
	relationshipSchemas: [],
	integrationProviders: [],
	configSchema: { fields: {}, unknownKeys: "strict" },
	metadata: {
		packageId,
		icon: "puzzle",
		version: "1.0.0",
		name: { key: "plugin.name" },
		description: { key: "plugin.description" },
	},
});

/**
 * Seeds an active system plugin whose revision `revisionId` has an empty manifest, installed and
 * initialized for each of `userIds` as `<pluginId>:<userId>`. A test inserts the definitions it reads
 * against `revisionId` itself.
 */
export const seedPluginRevision = Effect.fn("seedPluginRevision")(function* (input: {
	readonly pluginId: string;
	readonly revisionId: string;
	readonly packageId: PluginPackageId;
	readonly userIds: ReadonlyArray<string>;
}) {
	const session = yield* DatabaseSession;
	const manifest = emptyManifest(input.packageId);
	const { metadata, ...sections } = manifest;
	yield* session.run((db) =>
		Effect.gen(function* () {
			yield* db
				.insert(tables.plugin)
				.values({ id: input.pluginId, status: "inactive", packageId: input.packageId });
			yield* db
				.insert(tables.pluginRevision)
				.values({
					...sections,
					...metadata,
					manifest,
					id: input.revisionId,
					pluginId: input.pluginId,
					contentHash: input.revisionId,
					clientConfigSchema: { fields: {} },
					sandboxAuthority: {
						scriptKinds: {},
						workflowScripts: {},
						packageId: input.packageId,
						userBootstrapScriptSlugs: [],
						configSchema: manifest.configSchema,
						schemaScope: {
							eventSchemas: [],
							entitySchemaSlugs: [],
							signalSchemaSlugs: [],
							relationshipSchemaSlugs: [],
						},
					},
				});
			yield* db
				.update(tables.plugin)
				.set({ status: "active", activeRevisionId: input.revisionId })
				.where(eq(tables.plugin.id, input.pluginId));
			if (input.userIds.length > 0) {
				yield* db
					.insert(tables.pluginInstallation)
					.values(
						input.userIds.map((userId) => ({
							userId,
							isInitialized: true,
							pluginId: input.pluginId,
							id: `${input.pluginId}:${userId}`,
						})),
					);
			}
		}),
	);
});
