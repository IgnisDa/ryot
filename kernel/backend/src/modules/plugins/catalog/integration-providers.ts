import type { SourcePlan } from "@ryot-app/contract/modules/plugins/execution";
import type { IngestionReadinessMetadata } from "@ryot-app/contract/modules/plugins/ingestion-readiness";
import type { PluginIntegrationProvider } from "@ryot-app/contract/modules/plugins/manifest";
import {
	type DeclarationReference,
	definitionOwner,
} from "@ryot-app/contract/modules/plugins/references";
import {
	type PluginPackageId,
	SandboxScriptId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { and, eq, type SQL, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { installationSlugWhere, referenceWhere } from "#platform/db/definition-owner";
import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

import { type CatalogScript, catalogScriptFields } from "../packages/persisted-projections";
import { ingestionReadinessMetadata } from "./readiness-metadata";
import type { pluginConfigContextFor } from "./runtime-resolver";

export type RegisteredIntegrationProvider = {
	readonly slug: string;
	readonly name: string;
	readonly pluginId: string;
	readonly description: string;
	readonly installationId: string;
	readonly requiresProKey?: boolean;
	readonly settingsSchema: AppSchema;
	readonly scriptSlug: null | string;
	readonly packageId: PluginPackageId;
	readonly plan?: undefined | SourcePlan;
	readonly pluginScope: "user" | "system";
	readonly reference: DeclarationReference;
	readonly lot: PluginIntegrationProvider["lot"];
	readonly readinessMetadata: IngestionReadinessMetadata;
	readonly configContext: ReturnType<typeof pluginConfigContextFor>;
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
					scripts: schema.pluginRevision.scripts,
					installationId: provider.installationId,
					requiresProKey: provider.requiresProKey,
					settingsSchema: provider.settingsSchema,
					workflows: schema.pluginRevision.workflows,
					packageId: schema.pluginRevision.packageId,
					pluginRevisionId: provider.pluginRevisionId,
					configRevisionId: provider.configRevisionId,
					configSchema: schema.pluginRevision.configSchema,
					oauthProviders: schema.pluginRevision.oauthProviders,
					integrationProviders: schema.pluginRevision.integrationProviders,
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
					scripts,
					pluginId,
					workflows,
					pluginScope,
					configSchema,
					configuredKeys,
					installationId,
					oauthProviders,
					configRevisionId,
					pluginRevisionId,
					integrationProviders,
					...row
				}): ReadonlyArray<{
					readonly script: null | CatalogScript;
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
						readonly script: null | CatalogScript;
						readonly provider: RegisteredIntegrationProvider;
					} = {
						script: script && { ...script, pluginId, id: SandboxScriptId.make(script.id) },
						provider: {
							readinessMetadata: ingestionReadinessMetadata(
								{ scripts, workflows, configSchema, oauthProviders },
								configuredKeys,
								configRevisionId !== null,
							),
							plan: integrationProviders.flatMap((declared) =>
								declared.slug === row.slug && declared.lot !== "push" && declared.plan
									? [declared.plan]
									: [],
							)[0],
							...row,
							pluginId,
							pluginScope,
							installationId,
							reference: { slug: row.slug, owner: definitionOwner(pluginId) },
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
				const [resolved] = yield* queryProviders(userId, referenceWhere(provider, reference));
				return resolved?.provider ?? null;
			});

			const resolveOwnedForUser = Effect.fn("IntegrationProviderCatalog.resolveOwnedForUser")(
				function* (userId: UserId, providerSlug: string, installationId: string) {
					const [resolved] = yield* queryProviders(
						userId,
						installationSlugWhere(provider, providerSlug, installationId),
					);
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
