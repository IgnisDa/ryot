export const groupColors = ["blue", "purple", "teal", "orange", "crimson"] as const;

export type GroupColor = (typeof groupColors)[number];

export const groupColorVariable = (color: GroupColor, options: { readonly soft?: boolean } = {}) =>
	`var(--group-${color}${options.soft === true ? "-soft" : ""})`;
