import { camelCase, startCase } from "./lodash";

/**
 * Trims a string and returns it if non-empty, otherwise returns undefined (for create payloads).
 */
export const trimmedOrUndefined = (value: string): string | undefined => {
	const trimmed = value.trim();
	return trimmed === "" ? undefined : trimmed;
};

/**
 * Trims a string and returns it if non-empty, otherwise returns null (for update payloads).
 */
export const trimmedOrNull = (value: string): string | null => {
	const trimmed = value.trim();
	return trimmed === "" ? null : trimmed;
};

/**
 * Generate initials for a given string.
 */
export const getInitials = (name: string) => {
	const rgx = new RegExp(/(\p{L}{1})\p{L}+/gu);
	const initials = [...name.matchAll(rgx)];
	const actualValues = ((initials.shift()?.[1] ?? "") + (initials.pop()?.[1] ?? "")).toUpperCase();
	return actualValues;
};

/**
 * Change case to a presentable format.
 */
export const changeCase = (name: string) => startCase(camelCase(name.toLowerCase()));
