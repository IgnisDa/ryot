import { supersetColor } from "../shared/superset-colors";

export const supersetColorVariable = (color: string) => `var(--group-${supersetColor(color)})`;

export const supersetSoftColorVariable = (color: string) =>
	`var(--group-${supersetColor(color)}-soft)`;
