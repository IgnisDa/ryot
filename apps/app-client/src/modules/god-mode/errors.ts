import { Unauthorized } from "@ryot/contract/errors";
import { Cause, Option } from "effect";

export const isUnauthorizedCause = (cause: Cause.Cause<unknown>) =>
	Option.exists(Cause.findErrorOption(cause), (error) => error instanceof Unauthorized);
