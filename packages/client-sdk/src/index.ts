import type {
	PluginOperationFailureReason,
	PluginRyotQLFailureReason,
} from "@ryot/contract/modules/plugins/client";
import { isJsonValue, type JsonValue } from "@ryot/contract/schema/json";
import type { PreparedRecipe } from "@ryot/ryotql";
import { Result, Schema } from "effect";

export type RyotQueryErrorReason = PluginRyotQLFailureReason | "malformed-result";

export class RyotQueryError extends Error {
	readonly reason: RyotQueryErrorReason;

	constructor(reason: RyotQueryErrorReason) {
		super(`Ryot query failed: ${reason}`);
		this.reason = reason;
	}
}

export type PluginOperationErrorReason =
	| "invalid-input"
	| "malformed-result"
	| PluginOperationFailureReason;

export class PluginOperationError extends Error {
	readonly reason: PluginOperationErrorReason;

	constructor(reason: PluginOperationErrorReason) {
		super(`Plugin operation failed: ${reason}`);
		this.reason = reason;
	}
}

export type OperationInvocation<Output extends Schema.Codec<unknown, unknown>> = {
	readonly slug: string;
	readonly input: JsonValue;
	readonly output: Output;
};

export type RyotClientAdapter = {
	readonly query: (document: PreparedRecipe<unknown>["document"]) => Promise<unknown>;
	readonly invokeOperation?: (request: {
		readonly slug: string;
		readonly input: JsonValue;
	}) => Promise<unknown>;
};

export const createRyotClient = (adapter: RyotClientAdapter) => ({
	data: {
		query: async <Success>(recipe: PreparedRecipe<Success>) => {
			let response: unknown;
			try {
				response = await adapter.query(recipe.document);
			} catch (error) {
				throw error instanceof RyotQueryError ? error : new RyotQueryError("transport");
			}
			const decoded = recipe.decode(response);
			if (Result.isFailure(decoded)) {
				throw new RyotQueryError("malformed-result");
			}
			return decoded.success;
		},
		invokeOperation: async <Output extends Schema.Codec<unknown, unknown>>(
			request: OperationInvocation<Output>,
		) => {
			if (!isJsonValue(request.input)) {
				throw new PluginOperationError("invalid-input");
			}
			if (!adapter.invokeOperation) {
				throw new PluginOperationError("transport");
			}
			let value: unknown;
			try {
				value = await adapter.invokeOperation({ slug: request.slug, input: request.input });
			} catch (error) {
				throw error instanceof PluginOperationError ? error : new PluginOperationError("transport");
			}
			const decoded = Schema.decodeUnknownResult(request.output)(value);
			if (Result.isFailure(decoded)) {
				throw new PluginOperationError("malformed-result");
			}
			return decoded.success;
		},
	},
});

export type RyotClient = ReturnType<typeof createRyotClient>;
