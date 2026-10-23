export const chunk = <T>(items: readonly T[], size: number): readonly (readonly T[])[] =>
	Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
		items.slice(index * size, (index + 1) * size),
	);
