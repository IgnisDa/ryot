export const roundHalfUp = (value: number, scale: number) =>
	Math.round((value + Number.EPSILON) * 10 ** scale) / 10 ** scale;
