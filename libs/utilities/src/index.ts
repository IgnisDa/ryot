import { camelCase, startCase } from "lodash";

/**
 * Generate initials for a given string.
 */
export const getInitials = (name: string) => {
	const rgx = new RegExp(/(\p{L}{1})\p{L}+/, "gu");
	const initials = [...name.matchAll(rgx)] || [];
	const actuals = (
		(initials.shift()?.[1] || "") + (initials.pop()?.[1] || "")
	).toUpperCase();
	return actuals;
};

/**
 * Change case to a presentable format
 */
export const changeCase = (name: string) =>
	startCase(camelCase(name.toLowerCase()));

export { startCase, camelCase };
