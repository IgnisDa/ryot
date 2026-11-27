import {
	ClientPagePreparationError,
	type ClientPageTarget,
	type PreparedClientPage,
} from "@ryot-app/contract/modules/pages/schemas";
import { Effect, Schema } from "effect";

import { PagesApi } from "#/api/pages";
import type { ApiScope } from "#/api/scope";

export type ClientPagePreparation =
	| { readonly kind: "ready"; readonly prepared: PreparedClientPage }
	| { readonly kind: "unavailable"; readonly reason: ClientPagePreparationError["reason"] };

const isPreparationError = Schema.is(ClientPagePreparationError);

export const prepareClientPage = (scope: ApiScope, target: ClientPageTarget) =>
	Effect.flatMap(PagesApi, (api) => api.prepare(scope, { payload: { target } })).pipe(
		Effect.map((prepared): ClientPagePreparation => ({ prepared, kind: "ready" })),
		Effect.catchTag("AuthenticatedApiError", (error) =>
			isPreparationError(error.cause)
				? Effect.succeed<ClientPagePreparation>({ kind: "unavailable", reason: error.cause.reason })
				: Effect.fail(error),
		),
	);
