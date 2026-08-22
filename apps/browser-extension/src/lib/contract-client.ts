import { runContract, type ContractProgram } from "@ryot-app/contract/client";
import { IntegrationWebhookToken, PluginSlug } from "@ryot-app/contract/schema/brands";
import { metadataLookupRecipe } from "@ryot-app/media-plugin/contracts/operation-recipes";
import { invokeOperationRecipe } from "@ryot-app/plugin-kit/operations";
import { Effect } from "effect";

const resolveConnection = (integrationUrl: string) => {
	const url = new URL(integrationUrl);
	const matched = url.pathname.match(/\/(?:_i|api\/webhooks\/integrations)\/([^/]+)\/?$/);
	const webhookToken = matched?.[1];
	if (!webhookToken) {
		throw new Error("Integration URL must be a Ryot webhook URL");
	}

	return {
		baseUrl: `${url.origin}/api`,
		webhookToken: IntegrationWebhookToken.make(decodeURIComponent(webhookToken)),
	};
};

const runForIntegration = <A, E>(integrationUrl: string, program: ContractProgram<A, E>) => {
	const { baseUrl } = resolveConnection(integrationUrl);
	return runContract(program, { baseUrl });
};

export const lookupMetadata = async (integrationUrl: string, title: string) => {
	const { webhookToken } = resolveConnection(integrationUrl);
	const { results } = await runForIntegration(integrationUrl, (client) =>
		invokeOperationRecipe(metadataLookupRecipe, { webhookToken, titles: [title] }, (request) =>
			client.plugins
				.invoke({
					payload: { payload: request.payload },
					params: {
						operationSlug: request.operationSlug,
						pluginSlug: PluginSlug.make(request.pluginSlug),
					},
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

export const postIntegrationWebhook = (integrationUrl: string, payload: unknown) => {
	const { webhookToken } = resolveConnection(integrationUrl);
	return runForIntegration(integrationUrl, (client) =>
		client.integrations.webhook({ params: { webhookToken }, payload: JSON.stringify(payload) }),
	);
};
