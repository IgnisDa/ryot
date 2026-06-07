import type { SandboxRunInput } from "./service";

export type BoundHostFunction = (...args: ReadonlyArray<unknown>) => Promise<unknown>;

export const apiSuccess = <T>(data: T) => ({ data, success: true as const });
export const apiFailure = (error: string) => ({ error, success: false as const });

export const isSandboxRunInput = (value: unknown): value is SandboxRunInput =>
	value !== null &&
	typeof value === "object" &&
	typeof Reflect.get(value, "userId") === "string" &&
	typeof Reflect.get(value, "scriptId") === "string" &&
	typeof Reflect.get(value, "driverName") === "string" &&
	typeof Reflect.get(value, "executionId") === "string";

export const requireSandboxRunInput = (
	args: ReadonlyArray<unknown>,
	index: number,
	fnName: string,
) => {
	const input = args[index];
	if (!isSandboxRunInput(input)) {
		throw new Error(`${fnName} is missing sandbox execution input`);
	}

	return input;
};
