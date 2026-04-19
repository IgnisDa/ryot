export const expectDefined = <T>(value: T | undefined, message: string): T => {
	if (value === undefined) {
		throw new Error(message);
	}
	return value;
};

export const resolveMockResponse = <T>(value: unknown): Promise<T> => {
	// oxlint-disable-next-line no-unsafe-type-assertion
	return Promise.resolve(value as T);
};
