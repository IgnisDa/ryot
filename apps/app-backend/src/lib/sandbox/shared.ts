import type { SandboxRunInput } from "./service";

export type BoundHostFunction = (...args: ReadonlyArray<unknown>) => Promise<unknown>;

export type UserSandboxRunInput = SandboxRunInput & { readonly userId: string };

export const apiSuccess = <T>(data: T) => ({ data, success: true as const });
export const apiFailure = (error: string) => ({ error, success: false as const });

export const isSandboxRunInput = (value: unknown): value is SandboxRunInput => {
	if (value === null || typeof value !== "object") {
		return false;
	}

	const userId = Reflect.get(value, "userId");
	return (
		(userId === null || typeof userId === "string") &&
		typeof Reflect.get(value, "scriptId") === "string" &&
		typeof Reflect.get(value, "driverName") === "string" &&
		typeof Reflect.get(value, "executionId") === "string"
	);
};

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

const hasUserContext = (input: SandboxRunInput): input is UserSandboxRunInput =>
	input.userId !== null;

export const requireUserSandboxRunInput = (
	args: ReadonlyArray<unknown>,
	index: number,
	fnName: string,
): UserSandboxRunInput => {
	const input = requireSandboxRunInput(args, index, fnName);
	if (!hasUserContext(input)) {
		throw new Error(`${fnName} is not available for system executions`);
	}

	return input;
};
