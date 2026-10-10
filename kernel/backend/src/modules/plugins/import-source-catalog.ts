import type { IngestionReadinessMetadata } from "@ryot-app/contract/modules/plugins/ingestion-readiness";
import type {
	PluginConfigSchema,
	PluginImportSource,
} from "@ryot-app/contract/modules/plugins/manifest";
import { SandboxScriptId, type UserId } from "@ryot-app/contract/schema/brands";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";

import { ingestionReadinessMetadata } from "./ingestion-readiness-metadata";
import { type CatalogScript, catalogScriptFields } from "./persisted-projections";
import type { pluginConfigContextFor } from "./runtime-resolver";

export type RegisteredImportSource = PluginImportSource & {
	readonly readinessMetadata: IngestionReadinessMetadata;
	readonly requiredPluginConfigKeys: ReadonlyArray<string>;
	readonly pluginId: string;
	readonly pluginSlug: string;
	readonly installationId: string;
	readonly pluginScope: "system" | "user";
	readonly configSchema: PluginConfigSchema;
	readonly configuredPluginConfigKeys: ReadonlyArray<string>;
	readonly configContext: ReturnType<typeof pluginConfigContextFor>;
};

const view = schema.userImportSource;

const querySourcesForSession = (database: DatabaseSession["Service"]) =>
	Effect.fn(function* (userId: UserId, predicate?: SQL) {
		const rows = yield* database.run((db) =>
			db
				.select({
					plan: view.plan,
					slug: view.slug,
					name: view.name,
					pluginId: view.pluginId,
					script: catalogScriptFields,
					exportHelp: view.exportHelp,
					pluginSlug: view.pluginSlug,
					pluginScope: view.pluginScope,
					description: view.description,
					inputSchema: view.inputSchema,
					workflowSlug: view.workflowSlug,
					installationId: view.installationId,
					pluginRevisionId: view.pluginRevisionId,
					configRevisionId: view.configRevisionId,
					manifest: schema.pluginRevision.manifest,
					requiredPluginConfigKeys: view.requiredPluginConfigKeys,
					configSchema: sql<PluginConfigSchema>`${schema.pluginRevision.manifest} -> 'configSchema'`,
					configuredPluginConfigKeys: sql<
						ReadonlyArray<string>
					>`coalesce(${schema.pluginConfigRevision.configuredKeys}, '{}')`,
				})
				.from(view)
				.innerJoin(schema.pluginRevision, eq(schema.pluginRevision.id, view.pluginRevisionId))
				.leftJoin(schema.sandboxScript, eq(schema.sandboxScript.id, view.workflowScriptId))
				.leftJoin(
					schema.pluginConfigRevision,
					and(
						eq(schema.pluginConfigRevision.id, view.configRevisionId),
						eq(schema.pluginConfigRevision.pluginRevisionId, view.pluginRevisionId),
						sql`${schema.pluginConfigRevision.ownerUserId} is not distinct from case when ${view.pluginScope} = 'user' then ${view.userId} else null end`,
						sql`${schema.pluginConfigRevision.pluginInstallationId} is not distinct from case when ${view.pluginScope} = 'user' then ${view.installationId} else null end`,
					),
				)
				.where(and(eq(view.userId, userId), predicate)),
		);
		return rows
			.flatMap(
				({
					plan,
					script,
					manifest,
					pluginId,
					exportHelp,
					pluginSlug,
					pluginScope,
					installationId,
					configRevisionId,
					pluginRevisionId,
					...row
				}): ReadonlyArray<{
					readonly script: CatalogScript | null;
					readonly source: RegisteredImportSource;
				}> => {
					if (
						pluginId === null ||
						pluginSlug === null ||
						installationId === null ||
						pluginRevisionId === null ||
						pluginScope === null
					) {
						return [];
					}

					const result: {
						readonly script: CatalogScript | null;
						readonly source: RegisteredImportSource;
					} = {
						script: script && { ...script, pluginId, id: SandboxScriptId.make(script.id) },
						source: {
							readinessMetadata: ingestionReadinessMetadata(
								manifest,
								row.configuredPluginConfigKeys,
								configRevisionId !== null,
							),
							...(plan ? { plan } : {}),
							...row,
							pluginId,
							pluginSlug,
							pluginScope,
							installationId,
							...(exportHelp ? { exportHelp } : {}),
							configContext: {
								pluginRevisionId,
								kind: "revision" as const,
								configSchema: row.configSchema,
								pluginConfigRevisionId: configRevisionId,
								ownerUserId: pluginScope === "user" ? userId : null,
							},
						},
					};
					return [result];
				},
			)
			.sort(
				(left, right) =>
					left.source.pluginSlug.localeCompare(right.source.pluginSlug) ||
					left.source.slug.localeCompare(right.source.slug),
			);
	});

export class ImportSourceCatalog extends Context.Service<ImportSourceCatalog>()(
	"ImportSourceCatalog",
	{
		make: Effect.gen(function* () {
			const querySources = querySourcesForSession(yield* DatabaseSession);
			const listForUser = Effect.fn("ImportSourceCatalog.listForUser")(function* (userId: UserId) {
				return (yield* querySources(userId)).map(({ source, script }) => ({
					source,
					hasActiveWorkflow: script !== null,
				}));
			});

			const resolveForUser = Effect.fn("ImportSourceCatalog.resolveForUser")(function* (
				userId: UserId,
				sourceSlug: string,
			) {
				const [resolved] = yield* querySources(userId, eq(view.slug, sourceSlug));
				return resolved ?? null;
			});

			return { listForUser, resolveForUser };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
