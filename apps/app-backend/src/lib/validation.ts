import type { BadRequest } from "./errors";
import { badRequest } from "./errors";

export const trimToNull = (value: string): string | null => {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

export const requireText = (value: string, message: string): string | BadRequest =>
	trimToNull(value) ?? badRequest(message);
