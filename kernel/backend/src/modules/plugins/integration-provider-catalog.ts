import type {
	PluginConfigSchema,
	PluginIntegrationProvider,
} from "@ryot-app/contract/modules/plugins/manifest";
import { SandboxScriptId, type UserId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

import { type CatalogScript, catalogScriptFields } from "./persisted-projections";
import type { pluginConfigContextFor } from "./runtime-resolver";

export type RegisteredIntegrationProvider = {
	readonly slug: string;
	readonly name: string;
	readonly pluginId: string;
	readonly pluginSlug: string;
	readonly description: string;
	readonly installationId: string;
	readonly requiresProKey?: boolean;
	readonly settingsSchema: AppSchema;
	readonly scriptSlug: string | null;
	readonly pluginScope: "system" | "user";
	readonly configContext: ReturnType<typeof pluginConfigContextFor>;
	readonly lot: PluginIntegrationProvider["lot"];
};

const provider = schema.userIntegrationProvider;

const queryProviders = Effect.fn(function* (userId: UserId, predicate?: SQL) {
	const db = yield* Database;
	const rows = yield* mapDatabaseErrors(
		db
			.select({
				lot: provider.lot,
				slug: provider.slug,
				name: provider.name,
				pluginId: provider.pluginId,
				script: catalogScriptFields,
				pluginSlug: provider.pluginSlug,
				scriptSlug: provider.scriptSlug,
				pluginScope: provider.pluginScope,
				description: provider.description,
				installationId: provider.installationId,
				requiresProKey: provider.requiresProKey,
				settingsSchema: provider.settingsSchema,
				pluginRevisionId: provider.pluginRevisionId,
				configRevisionId: provider.configRevisionId,
				configSchema: sql<PluginConfigSchema>`${schema.pluginRevision.manifest} -> 'configSchema'`,
			})
			.from(provider)
			.innerJoin(schema.pluginRevision, eq(schema.pluginRevision.id, provider.pluginRevisionId))
			.leftJoin(schema.sandboxScript, eq(schema.sandboxScript.id, provider.scriptId))
			.where(and(eq(provider.userId, userId), predicate)),
	);
	return rows
		.map(
			({
				script,
				configSchema,
				configRevisionId,
				pluginRevisionId,
				...row
			}): {
				readonly script: CatalogScript | null;
				readonly provider: RegisteredIntegrationProvider;
			} => ({
				script: script && {
					...script,
					pluginId: row.pluginId,
					id: SandboxScriptId.make(script.id),
				},
				provider: {
					...row,
					configContext: {
						configSchema,
						pluginRevisionId,
						kind: "revision" as const,
						pluginConfigRevisionId: configRevisionId,
						ownerUserId: row.pluginScope === "user" ? userId : null,
					},
				},
			}),
		)
		.sort(
			(left, right) =>
				left.provider.pluginSlug.localeCompare(right.provider.pluginSlug) ||
				left.provider.slug.localeCompare(right.provider.slug),
		);
});

const ownedBy = (providerSlug: string, installationId: string) =>
	and(eq(provider.slug, providerSlug), eq(provider.installationId, installationId));

export class IntegrationProviderCatalog extends Context.Service<IntegrationProviderCatalog>()(
	"IntegrationProviderCatalog",
	{
		make: Effect.sync(() => {
			const listResolvedForUser = Effect.fn("IntegrationProviderCatalog.listResolvedForUser")(
				(userId: UserId) => queryProviders(userId),
			);

			const findForUser = Effect.fn("IntegrationProviderCatalog.findForUser")(function* (
				userId: UserId,
				providerSlug: string,
			) {
				const [resolved] = yield* queryProviders(userId, eq(provider.slug, providerSlug));
				return resolved?.provider ?? null;
			});

			const resolveOwnedForUser = Effect.fn("IntegrationProviderCatalog.resolveOwnedForUser")(
				function* (userId: UserId, providerSlug: string, installationId: string) {
					const [resolved] = yield* queryProviders(userId, ownedBy(providerSlug, installationId));
					return resolved ?? null;
				},
			);

			const findOwnedForUser = Effect.fn("IntegrationProviderCatalog.findOwnedForUser")(function* (
				userId: UserId,
				providerSlug: string,
				installationId: string,
			) {
				return (yield* resolveOwnedForUser(userId, providerSlug, installationId))?.provider ?? null;
			});

			return { findForUser, findOwnedForUser, listResolvedForUser, resolveOwnedForUser };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
