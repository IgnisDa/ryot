import {
	PluginThemeSnapshot,
	type PluginThemeSnapshot as PluginThemeSnapshotValue,
	type RyotClientErrorReason,
} from "@ryot-app/contract/modules/plugins/client";
import { TemporaryUploadToken } from "@ryot-app/contract/modules/uploads/schemas";
import { isJsonValue, type JsonValue } from "@ryot-app/contract/schema/json";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

export type { RyotClientErrorReason } from "@ryot-app/contract/modules/plugins/client";

export type RyotThemeSnapshot = PluginThemeSnapshotValue;

export class RyotClientError extends Error {
	readonly reason: RyotClientErrorReason;

	constructor(reason: RyotClientErrorReason) {
		super(`Ryot client failed: ${reason}`);
		this.reason = reason;
	}
}

const asTransportError = (error: unknown) =>
	error instanceof RyotClientError ? error : new RyotClientError("transport");

export type OperationInvocation<Output extends Schema.Codec<unknown, unknown>> = {
	readonly slug: string;
	readonly output: Output;
	readonly input: JsonValue;
};

export type TemporaryUploadRequest = {
	readonly source: Blob;
	readonly fileName: string;
	readonly contentType: string;
};

export type RyotNavigationTarget = {
	readonly path: string;
	readonly search?: Record<string, string>;
};

export type RyotClientAdapter = {
	readonly query: (
		document: PreparedRecipe<unknown>["document"],
		signal?: AbortSignal,
	) => Promise<unknown>;
	readonly navigate?: (mode: "push" | "replace", target: RyotNavigationTarget) => void;
	readonly theme?: {
		readonly getSnapshot: () => unknown;
		readonly subscribe: (listener: () => void) => () => void;
	};
	readonly invokeOperation?: (request: {
		readonly slug: string;
		readonly input: JsonValue;
	}) => Promise<unknown>;
	readonly uploadTemporary?: (request: TemporaryUploadRequest) => Promise<unknown>;
};

export const createRyotClient = (adapter: RyotClientAdapter) => {
	let themeSnapshotInput: unknown;
	let themeSnapshot: PluginThemeSnapshotValue | undefined;
	const decodeThemeSnapshot = (value: unknown): PluginThemeSnapshotValue => {
		if (themeSnapshot && Object.is(value, themeSnapshotInput)) {
			return themeSnapshot;
		}
		const decoded = Schema.decodeUnknownResult(PluginThemeSnapshot)(value);
		if (Result.isFailure(decoded)) {
			throw new RyotClientError("malformed-result");
		}
		themeSnapshot = decoded.success;
		themeSnapshotInput = value;
		return themeSnapshot;
	};
	const getThemeSnapshot = () => {
		if (!adapter.theme) {
			throw new RyotClientError("unsupported-capability");
		}
		try {
			return decodeThemeSnapshot(adapter.theme.getSnapshot());
		} catch (error) {
			throw asTransportError(error);
		}
	};
	const navigate = (mode: "push" | "replace", target: RyotNavigationTarget) => {
		if (!adapter.navigate) {
			throw new RyotClientError("unsupported-capability");
		}
		try {
			adapter.navigate(mode, target);
		} catch (error) {
			throw asTransportError(error);
		}
	};

	return {
		navigation: {
			push: (target: RyotNavigationTarget) => navigate("push", target),
			replace: (target: RyotNavigationTarget) => navigate("replace", target),
		},
		data: {
			query: async <Success>(
				recipe: PreparedRecipe<Success>,
				options?: { readonly signal?: AbortSignal },
			) => {
				if (options?.signal?.aborted) {
					throw options.signal.reason;
				}
				let response: unknown;
				try {
					response = await adapter.query(recipe.document, options?.signal);
				} catch (error) {
					if (options?.signal?.aborted) {
						throw options.signal.reason;
					}
					throw asTransportError(error);
				}
				let decoded: ReturnType<typeof recipe.decode>;
				try {
					decoded = recipe.decode(response);
				} catch {
					throw new RyotClientError("malformed-result");
				}
				if (Result.isFailure(decoded)) {
					throw new RyotClientError("malformed-result");
				}
				return decoded.success;
			},
		},
		operations: {
			invoke: async <Output extends Schema.Codec<unknown, unknown>>(
				request: OperationInvocation<Output>,
			) => {
				if (!isJsonValue(request.input)) {
					throw new RyotClientError("invalid-input");
				}
				if (!adapter.invokeOperation) {
					throw new RyotClientError("unsupported-capability");
				}
				let value: unknown;
				try {
					value = await adapter.invokeOperation({ slug: request.slug, input: request.input });
				} catch (error) {
					throw asTransportError(error);
				}
				if (!isJsonValue(value)) {
					throw new RyotClientError("malformed-result");
				}
				const decoded = Schema.decodeUnknownResult(request.output)(value);
				if (Result.isFailure(decoded)) {
					throw new RyotClientError("malformed-result");
				}
				return decoded.success;
			},
		},
		uploads: {
			uploadTemporary: async (request: TemporaryUploadRequest) => {
				if (!adapter.uploadTemporary) {
					throw new RyotClientError("unsupported-capability");
				}
				let value: unknown;
				try {
					value = await adapter.uploadTemporary(request);
				} catch (error) {
					throw asTransportError(error);
				}
				const decoded = Schema.decodeUnknownResult(TemporaryUploadToken)(value);
				if (Result.isFailure(decoded)) {
					throw new RyotClientError("malformed-result");
				}
				return decoded.success;
			},
		},
		theme: {
			getSnapshot: getThemeSnapshot,
			subscribe: (listener: () => void) => {
				if (!adapter.theme) {
					throw new RyotClientError("unsupported-capability");
				}
				try {
					return adapter.theme.subscribe(() => {
						getThemeSnapshot();
						listener();
					});
				} catch (error) {
					throw asTransportError(error);
				}
			},
		},
	};
};

export type RyotClient = ReturnType<typeof createRyotClient>;
