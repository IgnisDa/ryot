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
