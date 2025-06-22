export type ServiceResult<T, E extends string = string> =
	| { data: T }
	| { error: E; message: string };

export const serviceData = <T>(data: T) => ({ data });

export const serviceError = <E extends string>(error: E, message: string) => ({
	error,
	message,
});

export const wrapServiceValidator = <T>(
	fn: () => T,
	fallback: string,
): ServiceResult<T, "validation"> => {
	try {
		return { data: fn() };
	} catch (err) {
		const message = err instanceof Error ? err.message : fallback;
		return { error: "validation", message };
	}
};
