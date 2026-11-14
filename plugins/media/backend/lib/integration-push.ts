import type {
	EntityRecord,
	IntegrationRecord,
	ListIntegrationsOptions,
	ScriptHost,
} from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { asRecord } from "@ryot-app/plugin-backend-sdk/wire";

export type IntegrationPushHost = Pick<
	ScriptHost,
	| "log"
	| "httpCall"
	| "executeRyotql"
	| "getEntitySchemas"
	| "listIntegrations"
	| "getUserPreferences"
>;

export const normalizeBaseUrl = (value: unknown) =>
	typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";

export const parseJsonBody = (
	result: Effect.Success<ReturnType<IntegrationPushHost["httpCall"]>>,
): unknown => {
	const body = result.body;
	if (typeof body !== "string" || !body.trim()) {
		return null;
	}
	try {
		return JSON.parse(body) as unknown;
	} catch {
		return null;
	}
};

export const integrationsDisabledForUser = (host: IntegrationPushHost) =>
	host.getUserPreferences().pipe(Effect.map((preferences) => preferences.disableIntegrations));

export const logPushFailure = (
	host: IntegrationPushHost,
	integration: string,
	error: { readonly message: string },
) =>
	host
		.log([
			{
				level: "warning",
				attributes: { error: error.message },
				message: `${integration} push failed`,
			},
		])
		.pipe(
			Effect.orElseSucceed(() => null),
			Effect.asVoid,
		);

export const listActiveIntegrations = (
	host: IntegrationPushHost,
	provider: NonNullable<ListIntegrationsOptions["provider"]>,
) => host.listIntegrations({ provider, isDisabled: false });

export const resolveEntityProviderName = (host: IntegrationPushHost, entity: EntityRecord) => {
	if (!entity.providerId) {
		return Effect.succeed(null);
	}
	return host
		.getEntitySchemas([entity.entitySchemaSlug])
		.pipe(
			Effect.map(
				([schema]) =>
					schema?.providers.find((provider) => provider.providerId === entity.providerId)?.name ??
					null,
			),
		);
};

export const collectionSyncMatches = (integration: IntegrationRecord, collectionId: string) => {
	const specifics = asRecord(integration.providerSpecifics);
	const ids =
		specifics && Array.isArray(specifics["syncCollectionIds"])
			? specifics["syncCollectionIds"]
			: [];
	return ids.includes(collectionId);
};
