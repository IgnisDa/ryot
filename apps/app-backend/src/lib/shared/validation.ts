import { badRequest } from "@ryot/contract/errors";
import { Effect } from "effect";

export const trimToNull = (value: string) => {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

export const requireText = (value: string, message: string) => {
	const trimmed = trimToNull(value);
	return trimmed !== null ? Effect.succeed(trimmed) : badRequest(message);
};
