import type { Config } from "../lib/config";

export type ApiFunction = (
	...args: Array<unknown>
) => unknown | Promise<unknown>;

export interface SandboxRunOptions {
	code: string;
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

export type HttpCallOptions = {
	body?: string;
	headers?: Record<string, string>;
};

export type HttpCallSuccess = {
	success: true;
	data: {
		body: string;
		status: number;
		statusText: string;
		headers: Record<string, string>;
	};
};

export type HttpCallFailure = {
	error: string;
	success: false;
	status?: number;
};

export type HttpCallResult = HttpCallFailure | HttpCallSuccess;

export type ConfigValueSuccess = {
	success: true;
	data: Config[keyof Config];
};

export type ConfigValueFailure = {
	error: string;
	success: false;
};

export type ConfigValueResult = ConfigValueFailure | ConfigValueSuccess;
