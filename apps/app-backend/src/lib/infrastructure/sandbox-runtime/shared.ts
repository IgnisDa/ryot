import { unknownToMessage } from "@ryot/contract/errors";
import type { SandboxExecutionPayload } from "@ryot/contract/modules/sandbox/schemas";
import type {
	JsonValue,
	SandboxHostImplementationMap as SdkSandboxHostImplementationMap,
} from "@ryot/sandbox-sdk";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { Effect } from "effect";

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
	readonly subscriptionRun?: NonNullable<SandboxExecutionPayload["subscriptionRun"]>;
};

export type BoundHostFunction = (args: ReadonlyArray<unknown>) => Promise<unknown>;

export type UserSandboxRunInput<Input extends SandboxRunInput = SandboxRunInput> = Input & {
	readonly userId: string;
};

export type SandboxHostImplementationMap = SdkSandboxHostImplementationMap<SandboxRunInput>;

export type AdditionalSandboxHostImplementationMap = Omit<
	SandboxHostImplementationMap,
	"emitSignal" | "getCachedValue" | "httpCall" | "sendNotification" | "setCachedValue"
>;

export const apiSuccess = <T>(data: T) => ({ data, success: true as const });
export const apiFailure = (error: string) => ({ error, success: false as const });

export const runSandboxHostEffect = <A>(
	runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>,
	effect: Effect.Effect<A, unknown>,
) =>
	runPromise(
		effect.pipe(
			Effect.map(apiSuccess),
			Effect.catchAll((error) => Effect.succeed(apiFailure(unknownToMessage(error)))),
		),
	);

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

export type SubscriptionSandboxRunInput = SandboxRunInput & {
	readonly subscriptionRun: NonNullable<SandboxRunInput["subscriptionRun"]>;
};

const hasSubscriptionRun = (input: SandboxRunInput): input is SubscriptionSandboxRunInput =>
	input.subscriptionRun !== undefined;

export const requireSubscriptionSandboxRunInput = (
	input: SandboxRunInput,
	fnName: string,
): SubscriptionSandboxRunInput => {
	if (!hasSubscriptionRun(input)) {
		throw new Error(`${fnName} is available only to subscription executions`);
	}

	return input;
};

export const requireUserSandboxRunInput = <Input extends SandboxRunInput>(
	input: Input,
	fnName: string,
): UserSandboxRunInput<Input> => {
	if (!hasUserContext(input)) {
		throw new Error(`${fnName} is not available for system executions`);
	}

	return input as UserSandboxRunInput<Input>;
};
