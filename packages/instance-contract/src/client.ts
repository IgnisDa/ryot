import type { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { HttpApi, HttpApiClient } from "effect/http-api";

import { AccountAdminGroup } from "./account-admin";
import { ADMIN_ACCESS_TOKEN_HEADER } from "./admin-auth";

const api = HttpApi.make("ryot").add(AccountAdminGroup);

export const makeInstanceAdminClient = (
	baseUrl: string,
	token: string,
): ReturnType<typeof HttpApiClient.make<"ryot", typeof AccountAdminGroup>> =>
	HttpApiClient.make(api, {
		baseUrl,
		transformClient: HttpClient.mapRequest(
			HttpClientRequest.setHeader(ADMIN_ACCESS_TOKEN_HEADER, token),
		),
	});

export type InstanceAdminClient = Effect.Success<ReturnType<typeof makeInstanceAdminClient>>;
