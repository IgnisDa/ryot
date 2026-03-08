import type {
	EntityRecord,
	IntegrationRecord,
	ListIntegrationsOptions,
	SandboxHost,
} from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { buildEntityReadDocument } from "@ryot/sandbox-sdk/ryotql";

import { decodeEntityReadResponse } from "./ryotql";

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

export const fetchEntity = (
	host: IntegrationPushHost,
	entityId: string,
	entitySchemaSlug: string,
) =>
	host
		.executeRyotql(
			buildEntityReadDocument({ entityIds: [entityId], entitySchemaSlugs: [entitySchemaSlug] }),
		)
		.pipe(Effect.map(decodeEntityReadResponse));

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
