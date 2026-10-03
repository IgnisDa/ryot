import type { IngestionPlan } from "@ryot-app/contract/modules/imports/ingestion";
import {
	evaluateIngestionReadiness,
	type IngestionReadinessMetadata,
} from "@ryot-app/contract/modules/plugins/ingestion-readiness";
import type { IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Context, Data, Effect, Layer } from "effect";

import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { OAuthConnectionsRepository } from "#modules/oauth-connections/repository";

import { PluginConfigRevisions } from "./config-revisions";
import { ImportSourceCatalog } from "./import-source-catalog";
import { availablePluginConfigKeys } from "./ingestion-readiness-metadata";
import { IntegrationProviderCatalog } from "./integration-provider-catalog";
import type { pluginConfigContextFor } from "./runtime-resolver";

export class IngestionReadinessError extends Data.TaggedError("IngestionReadinessError")<{
	readonly message: string;
}> {}

const parseSettings = Effect.fn("parseIngestionReadinessSettings")(function* (
	settingsSchema: AppSchema,
	settings: Readonly<Record<string, unknown>> | undefined,
) {
	if (settings === undefined) {
		return undefined;
	}
	return yield* parseAppSchemaProperties({
		properties: settings,
		kind: "Ingestion settings",
		propertiesSchema: settingsSchema,
		allowedMissingRequiredPaths: Object.entries(settingsSchema.fields).flatMap(([key, property]) =>
			property.type === "string" && property.format?.kind === "oauth-connection" ? [[key]] : [],
		),
	}).pipe(
		Effect.mapError(() => new IngestionReadinessError({ message: "Invalid ingestion settings" })),
	);
});

const evaluate = Effect.fn("evaluateIngestionReadinessEffect")(
	(input: Parameters<typeof evaluateIngestionReadiness>[0]) =>
		Effect.try({
			try: () => evaluateIngestionReadiness(input),
			catch: (error) =>
				new IngestionReadinessError({
					message: error instanceof Error ? error.message : "Invalid ingestion plan",
				}),
		}),
);

export class IngestionReadinessService extends Context.Service<IngestionReadinessService>()(
	"IngestionReadinessService",
	{
		make: Effect.gen(function* () {
			const imports = yield* ImportSourceCatalog;
			const integrations = yield* IntegrationProviderCatalog;
			const configs = yield* PluginConfigRevisions;
			const connections = yield* OAuthConnectionsRepository;
			const availableConfigKeys = Effect.fn("IngestionReadinessService.availableConfigKeys")(
				function* (
					context: ReturnType<typeof pluginConfigContextFor>,
					installationId: string,
					oauthProviders: IngestionReadinessMetadata["oauthProviders"],
				) {
					const config =
						context.pluginConfigRevisionId === null
							? {}
							: yield* configs.read({
									ownerUserId: context.ownerUserId,
									id: context.pluginConfigRevisionId,
									pluginRevisionId: context.pluginRevisionId,
									pluginInstallationId: context.ownerUserId === null ? null : installationId,
								});
					return availablePluginConfigKeys(context.configSchema, oauthProviders, config);
				},
			);
			const evaluateImport = Effect.fn("IngestionReadinessService.evaluateImport")(
				function* (input: {
					readonly userId: UserId;
					readonly sourceSlug: string;
					readonly installationId: string;
					readonly settings?: Readonly<Record<string, unknown>>;
					readonly acceptedPlan?: IngestionPlan;
				}) {
					const resolved = yield* imports.resolveForUser(input.userId, input.sourceSlug);
					if (!resolved?.script || resolved.source.installationId !== input.installationId) {
						return yield* new IngestionReadinessError({
							message: "Import source operation is unavailable",
						});
					}
					const { source, script } = resolved;
					const settings = yield* parseSettings(source.inputSchema, input.settings);
					const available = yield* availableConfigKeys(
						source.configContext,
						source.installationId,
						source.readinessMetadata.oauthProviders,
					);
					const readiness = yield* evaluate({
						settings,
						kind: "workflow",
						sourcePlan: source.plan,
						operation: source.workflowSlug,
						acceptedPlan: input.acceptedPlan,
						settingsSchema: source.inputSchema,
						metadata: { ...source.readinessMetadata, availableConfigKeys: available },
					});
					return {
						...resolved,
						readiness,
						pins: {
							scriptId: script.id,
							pluginRevisionId: source.configContext.pluginRevisionId,
							pluginConfigRevisionId: source.configContext.pluginConfigRevisionId,
						},
					};
				},
			);
			const evaluateIntegration = Effect.fn("IngestionReadinessService.evaluateIntegration")(
				function* (input: {
					readonly userId: UserId;
					readonly providerSlug: string;
					readonly installationId: string;
					readonly settings?: Readonly<Record<string, unknown>>;
					readonly integrationId?: IntegrationId;
					readonly acceptedPlan?: IngestionPlan;
				}) {
					const resolved = yield* integrations.resolveOwnedForUser(
						input.userId,
						input.providerSlug,
						input.installationId,
					);
					if (!resolved?.script) {
						return yield* new IngestionReadinessError({
							message: "Integration provider operation is unavailable",
						});
					}
					const { script, provider } = resolved;
					const settings = yield* parseSettings(provider.settingsSchema, input.settings);
					const rows =
						settings === undefined
							? []
							: yield* connections.listReadinessForUser(
									input.userId,
									input.installationId,
									input.providerSlug,
								);
					const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
					const connectedFields = rows
						.filter((row) => {
							const property = provider.settingsSchema.fields[row.field];
							return (
								row.status === "connected" &&
								(row.expiresAt === null || row.expiresAt.getTime() > now) &&
								row.integrationId === (input.integrationId ?? null) &&
								settings?.[row.field] === row.id &&
								property?.type === "string" &&
								property.format?.kind === "oauth-connection" &&
								property.format.provider === row.oauthProviderSlug
							);
						})
						.map(({ field }) => field);
					const available = yield* availableConfigKeys(
						provider.configContext,
						provider.installationId,
						provider.readinessMetadata.oauthProviders,
					);
					const readiness = yield* evaluate({
						settings,
						kind: "script",
						connectedFields,
						operation: script.slug,
						sourcePlan: provider.plan,
						acceptedPlan: input.acceptedPlan,
						settingsSchema: provider.settingsSchema,
						metadata: { ...provider.readinessMetadata, availableConfigKeys: available },
					});
					return {
						...resolved,
						readiness,
						pins: {
							scriptId: script.id,
							pluginRevisionId: provider.configContext.pluginRevisionId,
							pluginConfigRevisionId: provider.configContext.pluginConfigRevisionId,
						},
					};
				},
			);
			return { evaluateImport, evaluateIntegration };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide([
			ImportSourceCatalog.layer,
			IntegrationProviderCatalog.layer,
			PluginConfigRevisions.layer,
			OAuthConnectionsRepository.layer,
		]),
	);
}
