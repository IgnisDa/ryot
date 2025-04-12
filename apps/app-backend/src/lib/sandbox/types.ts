export type ApiFunction = (...args: Array<unknown>) => Promise<unknown>;

export type HostFunction<TContext extends Record<string, unknown>> = (
	context: TContext,
	...args: Array<unknown>
) => Promise<unknown>;

export type HostFunctionFactory = (
	context: Record<string, unknown>,
) => ApiFunction;

export interface ApiFunctionDescriptor {
	functionKey: string;
	context: Record<string, unknown>;
}

export interface SandboxRunOptions {
	code: string;
	userId: string;
	maxHeapMB?: number;
	timeoutMs?: number;
	context?: Record<string, unknown>;
	apiFunctions?: Record<string, ApiFunction>;
}

export interface SandboxResult {
	logs?: string;
	error?: string;
	value?: unknown;
	success: boolean;
}

export type ApiSuccess<T> = {
	data: T;
	success: true;
};

export type ApiFailure = {
	error: string;
	success: false;
};

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export const apiSuccess = <T>(data: T) => ({
	data,
	success: true as const,
});

export const apiFailure = (error: string) => ({
	error,
	success: false as const,
});

export type HttpCallOptions = {
	body?: string;
	headers?: Record<string, string>;
};

export type HttpCallSuccessData = {
	body: string;
	status: number;
	statusText: string;
	headers: Record<string, string>;
};

export type HttpCallErrorData = {
	status?: number;
};

export type HttpCallResult =
	| ApiSuccess<HttpCallSuccessData>
	| (ApiFailure & { data?: HttpCallErrorData });

export type ConfigValueResult = ApiResult<unknown>;
