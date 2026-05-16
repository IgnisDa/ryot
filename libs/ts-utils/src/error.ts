export const extractErrorMessage = (error: unknown, fallback: string) => {
	return error instanceof Error ? error.message : fallback;
};

export const resolveDataOrError = <T, E>(input: {
	fallback: string;
	callback: () => T;
	onError: (message: string) => E;
}) => {
	try {
		return { data: input.callback() } as const;
	} catch (error) {
		return input.onError(extractErrorMessage(error, input.fallback));
	}
};
