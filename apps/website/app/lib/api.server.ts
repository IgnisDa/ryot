import { FetchHttpClient, HttpApiClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { AppContract } from "@ryot/app-backend/contract";
import { Effect } from "effect";

import { getServerVariables } from "./config.server";

type ApiError = { message: string };
type ApiResult<T> = { data: T; error?: undefined } | { data?: undefined; error: ApiError };

type ProvisionUserBody =
	| { provider: "credential"; email: string; name: string }
	| { provider: "oidc"; email: string; name: string; oidcIssuerId: string };

const makeAdminClient = (baseUrl: string, adminToken: string) =>
	HttpApiClient.make(AppContract, {
		baseUrl,
		transformClient: HttpClient.mapRequest(
			HttpClientRequest.setHeaders({ "Admin-Access-Token": adminToken }),
		),
	});

type GodModeClient = Effect.Effect.Success<ReturnType<typeof makeAdminClient>>;

const errorMessage = (error: unknown): string =>
	typeof error === "object" &&
	error !== null &&
	"message" in error &&
	typeof error.message === "string"
		? error.message
		: "Failed to reach the backend server";

const runAdmin = <A, E>(
	program: (client: GodModeClient) => Effect.Effect<A, E>,
): Promise<ApiResult<A>> => {
	const serverVariables = getServerVariables();

	return makeAdminClient(
		`${serverVariables.RYOT_BASE_URL}/api`,
		serverVariables.SERVER_ADMIN_ACCESS_TOKEN,
	).pipe(
		Effect.flatMap(program),
		Effect.map((data): ApiResult<A> => ({ data })),
		Effect.catchAll((error) =>
			Effect.succeed<ApiResult<A>>({ error: { message: errorMessage(error) } }),
		),
		Effect.provide(FetchHttpClient.layer),
		Effect.runPromise,
	);
};

export const provisionUser = (body: ProvisionUserBody) =>
	runAdmin((client) =>
		body.provider === "oidc"
			? client.godMode.provisionUser({ payload: body })
			: client.godMode.provisionUser({ payload: body }),
	);

export const resetUserPassword = (userId: string) =>
	runAdmin((client) => client.godMode.resetUserPassword({ path: { userId } }));

export const setUserDisabled = (userId: string, disabled: boolean) =>
	runAdmin((client) =>
		client.godMode.setUserDisabled({ path: { userId }, payload: { disabled } }),
	);
