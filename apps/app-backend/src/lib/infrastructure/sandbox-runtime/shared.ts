import type {
	JsonValue,
	SandboxHostImplementationMap as SdkSandboxHostImplementationMap,
} from "@ryot/sandbox-sdk";
import { isObjectRecord } from "@ryot/ts-utils/predicates";

export type SandboxRunInput = {
	readonly context: unknown;
	readonly scriptId: string;
	readonly metadata: unknown;
	readonly driverName: string;
	readonly executionId: string;
	readonly compiledCode: string;
	readonly userId: string | null;
	readonly compiledFormat: number;
	readonly scriptIsBuiltin: boolean;
	readonly allowedHostFunctions: readonly string[];
};

export type BoundHostFunction = (args: ReadonlyArray<unknown>) => Promise<unknown>;

export type UserSandboxRunInput = SandboxRunInput & { readonly userId: string };

export type SandboxHostImplementationMap = SdkSandboxHostImplementationMap<SandboxRunInput>;

export type AdditionalSandboxHostImplementationMap = Omit<
	SandboxHostImplementationMap,
	"getCachedValue" | "httpCall" | "setCachedValue"
>;

export const apiSuccess = <T>(data: T) => ({ data, success: true as const });
export const apiFailure = (error: string) => ({ error, success: false as const });

export const isJsonValue = (value: unknown): value is JsonValue => {
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "string" ||
		(typeof value === "number" && Number.isFinite(value))
	) {
		return true;
	}

	if (Array.isArray(value)) {
		return value.every(isJsonValue);
	}

	if (!isObjectRecord(value)) {
		return false;
	}
	const prototype = Object.getPrototypeOf(value);
	return (
		(prototype === Object.prototype || prototype === null) &&
		Object.values(value).every(isJsonValue)
	);
};

export const toSandboxJsonValue = (value: unknown): JsonValue =>
	isJsonValue(value) ? value : null;

const hasUserContext = (input: SandboxRunInput): input is UserSandboxRunInput =>
	input.userId !== null;

export const requireUserSandboxRunInput = (
	input: SandboxRunInput,
	fnName: string,
): UserSandboxRunInput => {
	if (!hasUserContext(input)) {
		throw new Error(`${fnName} is not available for system executions`);
	}

	return input;
};
