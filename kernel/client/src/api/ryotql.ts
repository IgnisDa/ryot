import { AuthRateLimited, AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { RyotQLBadRequest, RyotQLInternalError } from "@ryot-app/contract/modules/ryotql/contract";
import { Schema } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";

const isDeclaredFailure = Schema.is(
	Schema.Union([AuthRateLimited, AuthUnauthorized, RyotQLBadRequest, RyotQLInternalError]),
);

export const classifyRyotQLFailure = (error: unknown) =>
	error instanceof AuthenticatedApiError && isDeclaredFailure(error.cause)
		? "query-failed"
		: "transport";
