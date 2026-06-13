import { HttpApiClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { AppContract } from "@ryot/app-backend/contract";
import { Effect } from "effect";

type RequestHeaders = Record<string, string>;

const makeContractClient = (baseUrl: string, headers: RequestHeaders) =>
	HttpApiClient.make(AppContract, {
		baseUrl,
		...(Object.keys(headers).length
			? { transformClient: HttpClient.mapRequest(HttpClientRequest.setHeaders(headers)) }
			: {}),
	});

type ContractClient = Effect.Effect.Success<ReturnType<typeof makeContractClient>>;

const withClient = <A, E, R>(
	baseUrl: string,
	headers: RequestHeaders,
	run: (client: ContractClient) => Effect.Effect<A, E, R>,
) =>
	Effect.gen(function* () {
		const client = yield* makeContractClient(baseUrl, headers);
		return yield* run(client);
	});

export { withClient };
export type { ContractClient, RequestHeaders };
