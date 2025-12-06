import { runContract, type ContractProgram } from "@ryot/contract/client";
import type { IntegrationWebhookPayload } from "@ryot/contract/modules/integrations/schemas";
import { IntegrationId } from "@ryot/contract/schema/brands";

const resolveConnection = (integrationUrl: string) => {
	const url = new URL(integrationUrl);
	const matched = url.pathname.match(/\/(?:_i|api\/webhooks\/integrations)\/([^/]+)\/?$/);
	const integrationId = matched?.[1];
	if (!integrationId) {
		throw new Error("Integration URL must be a Ryot webhook URL");
	}

	return {
		baseUrl: `${url.origin}/api`,
		integrationId: IntegrationId.make(decodeURIComponent(integrationId)),
	};
};

const runForIntegration = <A, E>(integrationUrl: string, program: ContractProgram<A, E>) => {
	const { baseUrl } = resolveConnection(integrationUrl);
	return runContract(program, { baseUrl });
};

export const lookupMetadata = (integrationUrl: string, title: string) => {
	const { integrationId } = resolveConnection(integrationUrl);
	return runForIntegration(integrationUrl, (client) =>
		client.metadataLookup.lookup({ payload: { title }, path: { integrationId } }),
	);
};

export const postIntegrationWebhook = (
	integrationUrl: string,
	payload: IntegrationWebhookPayload,
) => {
	const { integrationId } = resolveConnection(integrationUrl);
	return runForIntegration(integrationUrl, (client) =>
		client.integrations.webhook({ payload, path: { integrationId } }),
	);
};
