import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { Cause, Option } from "effect";

import { AdminApiError } from "#/api/admin";

const isUnauthorizedError = (error: unknown): boolean =>
	error instanceof AuthUnauthorized ||
	(error instanceof AdminApiError && isUnauthorizedError(error.cause));

export const isUnauthorizedCause = (cause: Cause.Cause<unknown>) =>
	Option.exists(Cause.findErrorOption(cause), isUnauthorizedError);
