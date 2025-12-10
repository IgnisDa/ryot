export type FilterUpdateFunction<T> = <K extends keyof T>(
	key: K,
	value: T[K] | null,
) => void;
