import type {
	EntityRecord,
	IntegrationRecord,
	ListIntegrationsOptions,
	SandboxHost,
} from "@ryot/sandbox-sdk";

export type IntegrationPushHost = SandboxHost<
	readonly ["httpCall", "getEntity", "getEntitySchema", "listIntegrations", "getUserPreferences"]
>;

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const jsonObject = (value: unknown): Readonly<Record<string, unknown>> | null =>
	isObject(value) ? value : null;

export const normalizeBaseUrl = (value: unknown) =>
	typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";

export const parseJsonBody = (
	result: Awaited<ReturnType<IntegrationPushHost["httpCall"]>>,
): unknown => {
	const body = result.success ? result.data.body : null;
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
	host.getUserPreferences().then((result) => result.success && result.data.disableIntegrations);

export const listActiveIntegrations = (
	host: IntegrationPushHost,
	provider: NonNullable<ListIntegrationsOptions["provider"]>,
) =>
	host
		.listIntegrations({ provider, isDisabled: false })
		.then((result): readonly IntegrationRecord[] => (result.success ? result.data : []));

export const fetchEntity = (host: IntegrationPushHost, entityId: string) =>
	host
		.getEntity(entityId)
		.then((result): EntityRecord | null => (result.success ? result.data : null));

export const resolveEntityProviderName = (host: IntegrationPushHost, entity: EntityRecord) => {
	if (!entity.sandboxScriptId) {
		return Promise.resolve(null);
	}
	return host.getEntitySchema(entity.entitySchemaId).then((result) => {
		if (!result.success) {
			return null;
		}
		return (
			result.data.providers.find((provider) => provider.scriptId === entity.sandboxScriptId)
				?.name ?? null
		);
	});
};

export const collectionSyncMatches = (integration: IntegrationRecord, collectionId: string) => {
	const specifics = jsonObject(integration.providerSpecifics);
	const ids =
		specifics && Array.isArray(specifics["syncCollectionIds"])
			? specifics["syncCollectionIds"]
			: [];
	return ids.includes(collectionId);
};
