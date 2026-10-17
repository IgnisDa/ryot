import type { IngestionReadinessMetadata } from "@ryot-app/contract/modules/plugins/ingestion-readiness";
import type {
	PluginConfigSchema,
	PluginImportSource,
} from "@ryot-app/contract/modules/plugins/manifest";
import {
	definitionOwner,
	type DeclarationReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	SandboxScriptId,
	type PluginPackageId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { installationSlugWhere, referenceWhere } from "#platform/db/definition-owner";
import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

import { type CatalogScript, catalogScriptFields } from "../packages/persisted-projections";
import { ingestionReadinessMetadata } from "./readiness-metadata";
import type { pluginConfigContextFor } from "./runtime-resolver";

export type RegisteredImportSource = PluginImportSource & {
	readonly readinessMetadata: IngestionReadinessMetadata;
	readonly requiredPluginConfigKeys: ReadonlyArray<string>;
	readonly pluginId: string;
	readonly packageId: PluginPackageId;
	readonly reference: DeclarationReference;
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
					pluginScope: view.pluginScope,
					description: view.description,
					inputSchema: view.inputSchema,
					workflowSlug: view.workflowSlug,
					installationId: view.installationId,
					scripts: schema.pluginRevision.scripts,
					pluginRevisionId: view.pluginRevisionId,
					configRevisionId: view.configRevisionId,
					workflows: schema.pluginRevision.workflows,
					packageId: schema.pluginRevision.packageId,
					configSchema: schema.pluginRevision.configSchema,
					oauthProviders: schema.pluginRevision.oauthProviders,
					requiredPluginConfigKeys: view.requiredPluginConfigKeys,
					configuredPluginConfigKeys: sql<
						ReadonlyArray<string>
					>`coalesce(${schema.pluginConfigRevision.configuredKeys}, '{}')`,
				})
				.from(view)
				.innerJoin(schema.pluginRevision, eq(schema.pluginRevision.id, view.pluginRevisionId))
				.leftJoin(
					schema.sandboxScript,
					and(
						eq(schema.sandboxScript.id, view.workflowScriptId),
						eq(schema.sandboxScript.pluginRevisionId, view.pluginRevisionId),
					),
				)
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
					scripts,
					pluginId,
					workflows,
					exportHelp,
					pluginScope,
					installationId,
					oauthProviders,
					configRevisionId,
					pluginRevisionId,
					...row
				}): ReadonlyArray<{
					readonly script: CatalogScript | null;
					readonly source: RegisteredImportSource;
				}> => {
					if (
						pluginId === null ||
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
								{ scripts, workflows, oauthProviders, configSchema: row.configSchema },
								row.configuredPluginConfigKeys,
								configRevisionId !== null,
							),
							...(plan ? { plan } : {}),
							...row,
							pluginId,
							pluginScope,
							installationId,
							reference: { slug: row.slug, owner: definitionOwner(pluginId) },
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
					left.source.packageId.localeCompare(right.source.packageId) ||
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
				reference: DeclarationReference,
			) {
				const [resolved] = yield* querySources(userId, referenceWhere(view, reference));
				return resolved ?? null;
			});
			const resolveOwnedForUser = Effect.fn("ImportSourceCatalog.resolveOwnedForUser")(function* (
				userId: UserId,
				sourceSlug: string,
				installationId: string,
			) {
				const [resolved] = yield* querySources(
					userId,
					installationSlugWhere(view, sourceSlug, installationId),
				);
				return resolved ?? null;
			});

			return { listForUser, resolveForUser, resolveOwnedForUser };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
