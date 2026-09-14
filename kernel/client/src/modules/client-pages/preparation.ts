import {
	ClientPagePreparationError,
	type ClientPageTarget,
	type PreparedClientPage,
} from "@ryot-app/contract/modules/client-pages/schemas";
import { Effect, Schema } from "effect";

import { ClientPagesApi } from "#/api/client-pages";
import type { ApiScope } from "#/api/scope";

export type ClientPagePreparation =
	| { readonly kind: "ready"; readonly prepared: PreparedClientPage }
	| { readonly kind: "unavailable"; readonly reason: ClientPagePreparationError["reason"] };

const isPreparationError = Schema.is(ClientPagePreparationError);

export const prepareClientPage = (scope: ApiScope, target: ClientPageTarget) =>
	Effect.flatMap(ClientPagesApi, (api) => api.prepare(scope, { payload: { target } })).pipe(
		Effect.map((prepared): ClientPagePreparation => ({ prepared, kind: "ready" })),
		Effect.catchTag("AuthenticatedApiError", (error) =>
			isPreparationError(error.cause)
				? Effect.succeed<ClientPagePreparation>({ kind: "unavailable", reason: error.cause.reason })
				: Effect.fail(error),
		),
	);
