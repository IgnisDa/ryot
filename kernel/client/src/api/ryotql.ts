import { AuthRateLimited, AuthUnauthorized } from "@ryot/contract/auth-middleware";
import { RyotQLBadRequest, RyotQLInternalError } from "@ryot/contract/modules/ryotql/contract";
import { Schema } from "effect";

import { AuthenticatedApiError } from "./authenticated";

const isDeclaredFailure = Schema.is(
	Schema.Union([AuthRateLimited, AuthUnauthorized, RyotQLBadRequest, RyotQLInternalError]),
);

export const classifyRyotQLFailure = (error: unknown) =>
	error instanceof AuthenticatedApiError && isDeclaredFailure(error.cause)
		? "query-failed"
		: "transport";
