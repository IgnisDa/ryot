export const supersetColors = ["blue", "purple", "teal", "orange", "crimson"] as const;

export const supersetColor = (color: string) =>
	supersetColors.find((candidate) => candidate === color) ?? "blue";

export const supersetColorVariable = (color: string) => `var(--group-${supersetColor(color)})`;

export const supersetSoftColorVariable = (color: string) =>
	`var(--group-${supersetColor(color)}-soft)`;
