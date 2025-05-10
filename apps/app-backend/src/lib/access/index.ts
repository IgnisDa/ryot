import type { AccessCheck, AccessError, AccessResult } from "./types";

const defaultMessages: Record<AccessError, string> = {
	not_found: "Resource not found",
	forbidden: "Access denied",
	builtin_resource: "Built-in resources do not support this operation",
};

/**
 * Checks access for a scope using existence and optional custom rules.
 *
 * Note on `messages`: the `messages` override only applies to the top-level
 * existence check (`scope === undefined → not_found`). Individual rule objects
 * carry their own `message` field and are unaffected by `messages`.
 */
export const checkAccess = <T>(
	check: AccessCheck<T>,
): AccessResult<T, AccessError> => {
	const messages = { ...defaultMessages, ...check.messages };

	if (!check.scope) {
		return { error: "not_found", message: messages.not_found };
	}

	if (check.rules) {
		for (const rule of check.rules) {
			if (!rule.test(check.scope)) {
				return { error: rule.error, message: rule.message };
			}
		}
	}

	return { data: check.scope };
};

export const checkReadAccess = <T>(
	scope: T | undefined,
	messages?: Partial<Record<AccessError, string>>,
): AccessResult<T> => checkAccess({ scope, messages });

/**
 * Checks that a scope exists and belongs to a custom (non-builtin) resource.
 * `T` is constrained to `{ isBuiltin: boolean }` so the builtin check is
 * type-safe without any cast.
 */
export const checkCustomAccess = <T extends { isBuiltin: boolean }>(
	scope: T | undefined,
	messages?: Partial<Record<"not_found" | "builtin_resource", string>>,
): AccessResult<T, "not_found" | "builtin_resource"> => {
	const notFoundMessage = messages?.not_found ?? defaultMessages.not_found;
	const builtinMessage =
		messages?.builtin_resource ?? defaultMessages.builtin_resource;

	if (!scope) {
		return { error: "not_found", message: notFoundMessage };
	}

	if (scope.isBuiltin) {
		return { error: "builtin_resource", message: builtinMessage };
	}

	return { data: scope };
};
