import type { SourcePlan } from "@ryot-app/contract/modules/plugins/execution";
import type { IngestionReadinessMetadata } from "@ryot-app/contract/modules/plugins/ingestion-readiness";
import type {
	PluginConfigSchema,
	PluginIntegrationProvider,
} from "@ryot-app/contract/modules/plugins/manifest";
import type { DeclarationReference } from "@ryot-app/contract/modules/plugins/references";
import {
	PluginId,
	SandboxScriptId,
	type PluginPackageId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";

import { ingestionReadinessMetadata } from "./ingestion-readiness-metadata";
import { type CatalogScript, catalogScriptFields } from "./persisted-projections";
import type { pluginConfigContextFor } from "./runtime-resolver";

export type RegisteredIntegrationProvider = {
	readonly plan?: SourcePlan | undefined;
	readonly readinessMetadata: IngestionReadinessMetadata;
	readonly slug: string;
	readonly name: string;
	readonly pluginId: string;
	readonly packageId: PluginPackageId;
	readonly reference: DeclarationReference;
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

const queryProvidersForSession = (database: DatabaseSession["Service"]) =>
	Effect.fn(function* (userId: UserId, predicate?: SQL) {
		const rows = yield* database.run((db) =>
			db
				.select({
					lot: provider.lot,
					slug: provider.slug,
					name: provider.name,
					pluginId: provider.pluginId,
					script: catalogScriptFields,
					scriptSlug: provider.scriptSlug,
					pluginScope: provider.pluginScope,
					description: provider.description,
					installationId: provider.installationId,
					requiresProKey: provider.requiresProKey,
					settingsSchema: provider.settingsSchema,
					manifest: schema.pluginRevision.manifest,
					pluginRevisionId: provider.pluginRevisionId,
					configRevisionId: provider.configRevisionId,
					configSchema: sql<PluginConfigSchema>`${schema.pluginRevision.manifest} -> 'configSchema'`,
					configuredKeys: sql<
						ReadonlyArray<string>
					>`coalesce(${schema.pluginConfigRevision.configuredKeys}, '{}')`,
				})
				.from(provider)
				.innerJoin(schema.pluginRevision, eq(schema.pluginRevision.id, provider.pluginRevisionId))
				.leftJoin(
					schema.pluginConfigRevision,
					and(
						eq(schema.pluginConfigRevision.id, provider.configRevisionId),
						eq(schema.pluginConfigRevision.pluginRevisionId, provider.pluginRevisionId),
						sql`${schema.pluginConfigRevision.ownerUserId} is not distinct from case when ${provider.pluginScope} = 'user' then ${provider.userId} else null end`,
						sql`${schema.pluginConfigRevision.pluginInstallationId} is not distinct from case when ${provider.pluginScope} = 'user' then ${provider.installationId} else null end`,
					),
				)
				.leftJoin(
					schema.sandboxScript,
					and(
						eq(schema.sandboxScript.id, provider.scriptId),
						eq(schema.sandboxScript.pluginRevisionId, provider.pluginRevisionId),
					),
				)
				.where(and(eq(provider.userId, userId), predicate)),
		);
		return rows
			.flatMap(
				({
					script,
					manifest,
					pluginId,
					pluginScope,
					configSchema,
					configuredKeys,
					installationId,
					configRevisionId,
					pluginRevisionId,
					...row
				}): ReadonlyArray<{
					readonly script: CatalogScript | null;
					readonly provider: RegisteredIntegrationProvider;
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
						readonly provider: RegisteredIntegrationProvider;
					} = {
						script: script && { ...script, pluginId, id: SandboxScriptId.make(script.id) },
						provider: {
							readinessMetadata: ingestionReadinessMetadata(
								manifest,
								configuredKeys,
								configRevisionId !== null,
							),
							plan: manifest.integrationProviders.flatMap((declared) =>
								declared.slug === row.slug && declared.lot !== "push" && declared.plan
									? [declared.plan]
									: [],
							)[0],
							...row,
							pluginId,
							pluginScope,
							installationId,
							packageId: manifest.metadata.packageId,
							reference: {
								slug: row.slug,
								owner: { kind: "plugin", pluginId: PluginId.make(pluginId) },
							},
							configContext: {
								configSchema,
								pluginRevisionId,
								kind: "revision" as const,
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
					left.provider.packageId.localeCompare(right.provider.packageId) ||
					left.provider.slug.localeCompare(right.provider.slug),
			);
	});

const ownedBy = (providerSlug: string, installationId: string) =>
	and(eq(provider.slug, providerSlug), eq(provider.installationId, installationId));

export class IntegrationProviderCatalog extends Context.Service<IntegrationProviderCatalog>()(
	"IntegrationProviderCatalog",
	{
		make: Effect.gen(function* () {
			const queryProviders = queryProvidersForSession(yield* DatabaseSession);
			const listResolvedForUser = Effect.fn("IntegrationProviderCatalog.listResolvedForUser")(
				(userId: UserId) => queryProviders(userId),
			);

			const findForUser = Effect.fn("IntegrationProviderCatalog.findForUser")(function* (
				userId: UserId,
				reference: DeclarationReference,
			) {
				if (reference.owner.kind === "kernel") {
					return null;
				}
				const [resolved] = yield* queryProviders(
					userId,
					and(eq(provider.slug, reference.slug), eq(provider.pluginId, reference.owner.pluginId)),
				);
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
