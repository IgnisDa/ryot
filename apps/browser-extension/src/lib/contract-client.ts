import { FetchHttpClient, HttpApiClient } from "@effect/platform";
import { AppContract } from "@ryot/contract/contract";
import type { IntegrationWebhookPayload } from "@ryot/contract/modules/integrations/schemas";
import { IntegrationId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

const makeClient = (baseUrl: string) => HttpApiClient.make(AppContract, { baseUrl });

type ContractClient = Effect.Effect.Success<ReturnType<typeof makeClient>>;
type ContractProgram<A, E> = (client: ContractClient) => Effect.Effect<A, E>;

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

const runContract = <A, E>(integrationUrl: string, program: ContractProgram<A, E>) => {
	const { baseUrl } = resolveConnection(integrationUrl);
	return makeClient(baseUrl).pipe(
		Effect.flatMap(program),
		Effect.provide(FetchHttpClient.layer),
		Effect.runPromise,
	);
};

export const lookupMetadata = (integrationUrl: string, title: string) => {
	const { integrationId } = resolveConnection(integrationUrl);
	return runContract(integrationUrl, (client) =>
		client.metadataLookup.lookup({ payload: { title }, path: { integrationId } }),
	);
};

export const postIntegrationWebhook = (
	integrationUrl: string,
	payload: IntegrationWebhookPayload,
) => {
	const { integrationId } = resolveConnection(integrationUrl);
	return runContract(integrationUrl, (client) =>
		client.integrations.webhook({ payload, path: { integrationId } }),
	);
};
