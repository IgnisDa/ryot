import { AuthUnauthorized } from "@ryot/contract/auth-middleware";
import { Cause, Option } from "effect";

export const isUnauthorizedCause = (cause: Cause.Cause<unknown>) =>
	Option.exists(Cause.findErrorOption(cause), (error) => error instanceof AuthUnauthorized);
