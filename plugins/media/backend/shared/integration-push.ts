import type {
	EntityRecord,
	IntegrationRecord,
	ListIntegrationsOptions,
	SandboxHost,
} from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { entityReadRecipe, executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";

export type IntegrationPushHost = SandboxHost<
	readonly [
		"httpCall",
		"executeRyotql",
		"getEntitySchemas",
		"listIntegrations",
		"getUserPreferences",
	]
>;

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const jsonObject = (value: unknown): Readonly<Record<string, unknown>> | null =>
	isObject(value) ? value : null;

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

export const listActiveIntegrations = (
	host: IntegrationPushHost,
	provider: NonNullable<ListIntegrationsOptions["provider"]>,
) => host.listIntegrations({ provider, isDisabled: false });

export const fetchEntity = (host: IntegrationPushHost, entityId: string) =>
	executeRyotqlRecipe(host.executeRyotql, entityReadRecipe({ entityIds: [entityId] })).pipe(
		Effect.flatMap(({ items }) => {
			const entity = items[0];
			return entity ? Effect.succeed(entity) : Effect.fail(new Error("Entity not found"));
		}),
	);

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
	const specifics = jsonObject(integration.providerSpecifics);
	const ids =
		specifics && Array.isArray(specifics["syncCollectionIds"])
			? specifics["syncCollectionIds"]
			: [];
	return ids.includes(collectionId);
};
