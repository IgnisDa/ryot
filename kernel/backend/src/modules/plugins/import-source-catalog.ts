import type {
	PluginConfigSchema,
	PluginImportSource,
} from "@ryot-app/contract/modules/plugins/manifest";
import { SandboxScriptId, type UserId } from "@ryot-app/contract/schema/brands";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

import { type CatalogScript, catalogScriptFields } from "./persisted-projections";
import type { pluginConfigContextFor } from "./runtime-resolver";

export type RegisteredImportSource = PluginImportSource & {
	readonly pluginId: string;
	readonly pluginSlug: string;
	readonly installationId: string;
	readonly pluginScope: "system" | "user";
	readonly configSchema: PluginConfigSchema;
	readonly configuredPluginConfigKeys: ReadonlyArray<string>;
	readonly configContext: ReturnType<typeof pluginConfigContextFor>;
};

const view = schema.userImportSource;

const querySources = Effect.fn(function* (userId: UserId, predicate?: SQL) {
	const db = yield* Database;
	const rows = yield* mapDatabaseErrors(
		db
			.select({
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
				eq(schema.pluginConfigRevision.id, view.configRevisionId),
			)
			.where(and(eq(view.userId, userId), predicate)),
	);
	return rows
		.map(
			({
				script,
				exportHelp,
				configRevisionId,
				pluginRevisionId,
				...row
			}): { readonly script: CatalogScript | null; readonly source: RegisteredImportSource } => ({
				script: script && {
					...script,
					pluginId: row.pluginId,
					id: SandboxScriptId.make(script.id),
				},
				source: {
					...row,
					...(exportHelp ? { exportHelp } : {}),
					configContext: {
						pluginRevisionId,
						kind: "revision" as const,
						configSchema: row.configSchema,
						pluginConfigRevisionId: configRevisionId,
						ownerUserId: row.pluginScope === "user" ? userId : null,
					},
				},
			}),
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
		make: Effect.sync(() => {
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
