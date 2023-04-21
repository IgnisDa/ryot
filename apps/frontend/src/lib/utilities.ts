/**
 * Generate initials for a given string.
 */
export const getInitials = (name: string) => {
	let rgx = new RegExp(/(\p{L}{1})\p{L}+/, "gu");
	let initials = [...name.matchAll(rgx)] || [];
	let actuals = (
		(initials.shift()?.[1] || "") + (initials.pop()?.[1] || "")
	).toUpperCase();
	return actuals;
};
