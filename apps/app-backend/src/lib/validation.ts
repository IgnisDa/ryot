import { Effect } from "effect";

import { badRequest } from "./errors";

export const trimToNull = (value: string) => {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

export const requireText = (value: string, message: string) => {
	const trimmed = trimToNull(value);
	return trimmed !== null ? Effect.succeed(trimmed) : badRequest(message);
};
