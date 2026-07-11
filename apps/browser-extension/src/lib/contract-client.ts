import { runContract, type ContractProgram } from "@ryot/contract/client";
import type { IntegrationWebhookPayload } from "@ryot/contract/modules/integrations/schemas";
import { IntegrationId } from "@ryot/contract/schema/brands";
import { invokeOperationRecipe } from "@ryot/plugin-kit/operations";
import { metadataLookupRecipe } from "@ryot/plugin-media/operations/recipes";
import { Effect } from "effect";

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

export const lookupMetadata = async (integrationUrl: string, title: string) => {
	const { integrationId } = resolveConnection(integrationUrl);
	const { results } = await runForIntegration(integrationUrl, (client) =>
		invokeOperationRecipe(metadataLookupRecipe, { integrationId, titles: [title] }, (request) =>
			client.plugins
				.invoke({
					payload: { payload: request.payload },
					path: { pluginSlug: request.pluginSlug, operationSlug: request.operationSlug },
				})
				.pipe(Effect.map(({ result }) => result)),
		),
	);

	const result = results.at(0);
	if (!result) {
		throw new Error("Metadata lookup returned no result for the requested title");
	}

	return result;
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
