export type ServiceResult<T, E extends string = string> =
	| { data: T }
	| { error: E; message: string };
