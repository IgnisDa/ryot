import { SandboxFailureKind } from "@ryot-app/contract/errors";
import { SandboxExecutionMetadata } from "@ryot-app/contract/modules/plugins/execution-metadata";
import type { SandboxExecutionError } from "@ryot-app/contract/modules/sandbox/schemas";
import { jsonValueSchema } from "@ryot-app/contract/modules/sandbox/wire";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { sandboxManifestSchema, type SandboxWorkflowReference } from "@ryot-app/sandbox-sdk/core";
import { Clock, Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import {
	configureSandboxFilesystem,
	type SandboxFilesystemBinding,
} from "@ryot-app/sandbox-sdk/filesystem";
import type { SandboxHostError } from "@ryot-app/sandbox-sdk/wire";
import {
	workflowDurableCallRequestSchema,
	workflowDurableResultSchema,
	workflowReplayJournalEntrySchema,
	type workflowHostRequestSchema,
	type WorkflowReplayJournal,
	type WorkflowReplayJournalEntry,
} from "@ryot-app/sandbox-sdk/workflow";

import {
	approvedDependencyRuntime,
	disableCodeGeneration,
	installWorkflowDeterminismGuard,
} from "./isolate-bootstrap";
import {
	createLogCollector,
	executionError,
	isRecord,
	type SandboxLogCollector,
} from "./isolate-utilities";
import { MiB, SANDBOX_LIMITS, SANDBOX_RUNNER_LIMITS } from "./limits";
import {
	artifactReadRangeArgsSchema,
	artifactReadRangeResultSchema,
	base64DecodedLength,
	InlineBatchReplySchema,
	InlineBatchSchema,
	isBase64,
	journalReadResultSchema,
	SandboxInvocationResponseSchema,
	SandboxInvocationSchema,
	scratchWriteArgsSchema,
	type SandboxInvocation,
	type SandboxInvocationResponse,
} from "./sidecar-protocol";

const strictOptions = { onExcessProperty: "error" } as const;
const maxInvocationBytes = SANDBOX_LIMITS.execution.requestBytes;
const journalReads = SANDBOX_LIMITS.journalReads;
const scratchChunkBytes = SANDBOX_LIMITS.scratch.chunkBytes;
const consoleMethods = ["log", "info", "warn", "debug", "error"] as const;
let filesystemBinding: SandboxFilesystemBinding | undefined;
configureSandboxFilesystem(() => filesystemBinding);

const encoder = new TextEncoder();
const encodeText = encoder.encode.bind(encoder);
const journalDecoder = new TextDecoder("utf-8", { fatal: true });
const decodeJournalText = journalDecoder.decode.bind(journalDecoder);
const nativeArray = globalThis.Array;
const nativeDate = globalThis.Date;
const nativeDateParse = nativeDate.parse.bind(nativeDate);
const nativeError = globalThis.Error;
const nativeNumber = globalThis.Number;
const nativeString = globalThis.String;
const nativeUint8Array = globalThis.Uint8Array;
const nativeBigInt = globalThis.BigInt;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectKeys = Object.keys;
const objectHasOwn = Object.hasOwn;
const jsonParse = JSON.parse.bind(JSON);
const jsonStringify = JSON.stringify.bind(JSON);
const base64Encode = globalThis.btoa.bind(globalThis);
const performanceNow = globalThis.performance.now.bind(globalThis.performance);
const arrayIsArray = nativeArray.isArray;
const arraySortMethod = Object.getOwnPropertyDescriptor(nativeArray.prototype, "sort")?.value;
const uint8ArrayPrototype = Object.getPrototypeOf(nativeUint8Array.prototype);
const uint8ArraySubarrayMethod = Object.getOwnPropertyDescriptor(
	uint8ArrayPrototype,
	"subarray",
)?.value;
const arrayBufferTransferMethod = Object.getOwnPropertyDescriptor(
	ArrayBuffer.prototype,
	"transfer",
)?.value;
const transferBuffer = arrayBufferTransferMethod.call.bind(arrayBufferTransferMethod);
const releaseBytes = (bytes: Uint8Array) => {
	if (bytes.byteLength > 0) {
		transferBuffer(bytes.buffer, 0);
	}
};
const stringCharCodeAtMethod = Object.getOwnPropertyDescriptor(
	String.prototype,
	"charCodeAt",
)?.value;
const stringIncludesMethod = Object.getOwnPropertyDescriptor(String.prototype, "includes")?.value;
const regexpExecMethod = Object.getOwnPropertyDescriptor(RegExp.prototype, "exec")?.value;
const decodeRangeInto = (data: string, target: Uint8Array, offset: number) =>
	decodeBase64Into(data, target, offset)
		? Effect.void
		: Effect.fail(createFailure("Sandbox bridge returned invalid base64"));
const boundArraySort = arraySortMethod.call.bind(arraySortMethod);
const arrayFrom = nativeArray.from.bind(nativeArray);
const boundUint8ArraySubarray = uint8ArraySubarrayMethod.call.bind(uint8ArraySubarrayMethod);
const boundStringCharCodeAt = stringCharCodeAtMethod.call.bind(stringCharCodeAtMethod);
const boundStringIncludes = stringIncludesMethod.call.bind(stringIncludesMethod);
const stringFromCharCode = String.fromCharCode.bind(String);
const boundRegExpExec = regexpExecMethod.call.bind(regexpExecMethod);
const mathCeil = Math.ceil;
const mathMin = Math.min;
const numberIsFinite = nativeNumber.isFinite.bind(nativeNumber);
const decodeInvocation = Schema.decodeUnknownEffect(
	Schema.fromJsonString(SandboxInvocationSchema),
	strictOptions,
);

export type SandboxInvocationBridge = {
	readonly call: (name: string, args: JsonValue) => Promise<JsonValue>;
	readonly inlineBatch: (args: JsonValue) => JsonValue;
};

type SandboxRunnerPhase = SandboxExecutionError["phase"];
type RunnerPhaseFailure = {
	readonly phase: SandboxRunnerPhase;
	readonly error: unknown;
	readonly kind?: SandboxExecutionError["kind"];
};
type HostBudget = { http: number; total: number };
type DurableWorkflowReference = Pick<
	SandboxWorkflowReference<Schema.ConstraintDecoder<unknown>, Schema.ConstraintDecoder<unknown>>,
	"input" | "output" | "workflowSlug"
>;
type SandboxDefinition<
	Input extends Schema.ConstraintDecoder<unknown> = Schema.ConstraintDecoder<unknown>,
	Output extends Schema.ConstraintDecoder<unknown> = Schema.ConstraintDecoder<unknown>,
> = {
	readonly input: Input;
	readonly output: Output;
	readonly manifest: Record<string, unknown>;
	readonly definitionType: "ryot:sandbox-script";
	readonly run: (
		input: Input["Type"],
		host: Record<string, unknown>,
		execution: { metadata: unknown; startedAt: string; sandboxScriptId: string },
	) => Effect.Effect<Output["Type"], unknown>;
};

const hostResultSchema = Schema.Union([
	Schema.Struct({
		error: Schema.String,
		success: Schema.Literal(false),
		data: Schema.optional(jsonValueSchema),
	}),
	Schema.Struct({ data: jsonValueSchema, success: Schema.Literal(true) }),
]);
const decodeHostResult = Schema.decodeUnknownEffect(hostResultSchema, strictOptions);
const decodeJournalEntry = Schema.decodeUnknownEffect(
	workflowReplayJournalEntrySchema,
	strictOptions,
);
const decodeDurableResult = Schema.decodeUnknownEffect(workflowDurableResultSchema, strictOptions);
const decodeJournalReadResult = Schema.decodeUnknownEffect(journalReadResultSchema, strictOptions);
const decodeArtifactReadRangeResult = Schema.decodeUnknownEffect(
	artifactReadRangeResultSchema,
	strictOptions,
);
const decodeScratchWriteArgs = Schema.decodeEffect(scratchWriteArgsSchema, strictOptions);
const decodeInvocationResponse = Schema.decodeUnknownSync(
	SandboxInvocationResponseSchema,
	strictOptions,
);
const decodeJsonValue = Schema.decodeUnknownEffect(jsonValueSchema, strictOptions);
const decodeManifest = Schema.decodeUnknownEffect(sandboxManifestSchema, strictOptions);
const decodeExecutionMetadata = Schema.decodeUnknownEffect(SandboxExecutionMetadata, strictOptions);
const durablePending = Symbol("sandbox-durable-call-pending");

const hasOwn = objectHasOwn;
const pushArray = <A>(values: A[], value: A) => {
	values[values.length] = value;
	return values.length;
};
const sliceArray = <A>(values: readonly A[], start: number) => {
	const result: A[] = [];
	for (let index = start; index < values.length; index += 1) {
		const value = values[index];
		if (value !== undefined) {
			result[result.length] = value;
		}
	}
	return result;
};
const includesArray = (values: readonly string[], value: string) => {
	for (let index = 0; index < values.length; index += 1) {
		if (values[index] === value) {
			return true;
		}
	}
	return false;
};
const someArray = <A>(values: readonly A[], predicate: (value: A) => boolean) => {
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index];
		if (value !== undefined && predicate(value)) {
			return true;
		}
	}
	return false;
};
const joinArray = (values: readonly string[], separator: string) => {
	let result = "";
	for (let index = 0; index < values.length; index += 1) {
		result += (index === 0 ? "" : separator) + (values[index] ?? "");
	}
	return result;
};
const sortArray = (values: string[]) => {
	boundArraySort(values);
};
const stringContains = (value: string, part: string) => {
	const result: unknown = boundStringIncludes(value, part);
	return typeof result === "boolean" && result;
};
const stringCharCodeAt = (value: string, index: number) => {
	const result: unknown = boundStringCharCodeAt(value, index);
	if (typeof result !== "number") {
		throw new nativeError("Sandbox bridge returned invalid base64");
	}
	return result;
};
const subarrayBytes = (bytes: Uint8Array, start: number, end: number) => {
	const result: unknown = boundUint8ArraySubarray(bytes, start, end);
	if (!(result instanceof nativeUint8Array)) {
		throw new nativeError("Sandbox runner could not read bytes");
	}
	return result;
};
const safeStringify = (value: unknown) => jsonStringify(value);
const bytesOf = (value: string) => encodeText(value).byteLength;
const createFailure = (message: string, data?: JsonValue): SandboxHostError =>
	data === undefined ? { message } : { data, message };

const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const base64Values = new nativeArray<number>(128).fill(-1);
for (let index = 0; index < base64Alphabet.length; index += 1) {
	base64Values[stringCharCodeAt(base64Alphabet, index)] = index;
}
const base64Value = (value: string, index: number) => {
	const code = stringCharCodeAt(value, index);
	return code === 61 && index >= value.length - 2 ? 0 : (base64Values[code] ?? -1);
};

const decodeBase64Into = (value: string, target: Uint8Array, offset: number) => {
	const end = offset + base64DecodedLength(value);
	if (!isBase64(value) || end > target.byteLength) {
		return false;
	}
	let output = offset;
	for (let index = 0; index < value.length; index += 4) {
		const first = base64Value(value, index);
		const second = base64Value(value, index + 1);
		const third = base64Value(value, index + 2);
		const fourth = base64Value(value, index + 3);
		if (first < 0 || second < 0 || third < 0 || fourth < 0) {
			return false;
		}
		const bits = (first << 18) | (second << 12) | (third << 6) | fourth;
		target[output++] = bits >>> 16;
		if (output < end) {
			target[output++] = bits >>> 8;
		}
		if (output < end) {
			target[output++] = bits;
		}
	}
	return true;
};

const encodeBase64 = (bytes: Uint8Array) => {
	let binary = "";
	for (let index = 0; index < bytes.length; index += 1) {
		binary += stringFromCharCode(bytes[index] ?? 0);
	}
	return base64Encode(binary);
};

const jsonClone = (value: unknown, label: string): JsonValue => {
	let serialized: string | undefined;
	try {
		serialized = safeStringify(value);
	} catch {
		throw new nativeError(label + " must be JSON-serializable");
	}
	if (typeof serialized !== "string") {
		throw new nativeError(label + " must be JSON-serializable");
	}
	const decoded = Schema.decodeUnknownResult(jsonValueSchema, strictOptions)(jsonParse(serialized));
	if (decoded._tag === "Failure") {
		throw new nativeError(label + " must be JSON-serializable");
	}
	return decoded.success;
};

const stableJson = (value: unknown): string => {
	if (arrayIsArray(value)) {
		const values = arrayFrom(value, (entry) => stableJson(entry));
		return "[" + joinArray(values, ",") + "]";
	}
	if (isRecord(value)) {
		const keys = objectKeys(value);
		sortArray(keys);
		const fields = arrayFrom(keys, (key) => safeStringify(key) + ":" + stableJson(value[key]));
		return "{" + joinArray(fields, ",") + "}";
	}
	return nativeString(safeStringify(value));
};

const transportArguments = (fnName: string, args: ReadonlyArray<unknown>) => {
	if (fnName !== "requestEventStreamWork") {
		return args;
	}
	const reference = args[1];
	if (args.length !== 2 || !isRecord(reference) || reference["referenceKind"] !== "script") {
		return null;
	}
	const scriptSlug = reference["scriptSlug"];
	if (typeof scriptSlug !== "string" || scriptSlug.length === 0) {
		return null;
	}
	return [args[0], { scriptSlug, referenceKind: "script" }];
};

const readErrorField = (error: unknown, field: "data" | "message"): unknown => {
	try {
		return isRecord(error) ? error[field] : undefined;
	} catch {
		return undefined;
	}
};

const errorMessage = (error: unknown) => {
	const message = readErrorField(error, "message");
	return typeof message === "string" ? message : nativeString(error);
};

const asSandboxHostError = (error: unknown): SandboxHostError => {
	const message = errorMessage(error);
	const data = readErrorField(error, "data");
	if (data === undefined) {
		return createFailure(message);
	}
	try {
		return createFailure(message, jsonClone(data, "Sandbox host error data"));
	} catch {
		return createFailure(message);
	}
};

const chargeHostCall = (budget: HostBudget, name: string): SandboxHostError | undefined => {
	budget.total += 1;
	if (name === "httpCall") {
		budget.http += 1;
	}
	if (budget.total > SANDBOX_RUNNER_LIMITS.hostCallCount) {
		return createFailure(SANDBOX_RUNNER_LIMITS.hostCallLimitMessage, {
			operation: name,
			code: "execution-limit",
		});
	}
	if (budget.http > SANDBOX_RUNNER_LIMITS.httpCallCount) {
		return createFailure(SANDBOX_RUNNER_LIMITS.httpCallLimitMessage, {
			operation: name,
			code: "execution-limit",
		});
	}
	return undefined;
};

const missingGrant = (message: string, operation: string): SandboxHostError =>
	createFailure(message, { operation, code: "missing-artifact-grant" });

const hostFailureKind = (error: unknown): SandboxExecutionError["kind"] | undefined => {
	const data = readErrorField(error, "data");
	return isRecord(data) && data["code"] === "external-uncertain" ? "external-uncertain" : undefined;
};

const phaseFailureKinds: Record<SandboxRunnerPhase, SandboxExecutionError["kind"]> = {
	input: "invalid-input",
	load: "missing-artifact",
	output: "invalid-output",
	execute: "script-failure",
};

const manifestsMatch = (left: unknown, right: SandboxInvocation["metadata"]) => {
	if (
		!isRecord(left) ||
		hasOwn(left, "capabilities") ||
		left["kind"] !== right.kind ||
		left["name"] !== right.name ||
		left["slug"] !== right.slug
	) {
		return false;
	}
	return (
		stableJson(left["automationType"]) === stableJson(right.automationType) &&
		stableJson(left["inputProjection"]) === stableJson(right.inputProjection) &&
		stableJson(left["searchOptionsSchema"]) === stableJson(right.searchOptionsSchema)
	);
};

const isSandboxDefinition = (value: unknown): value is SandboxDefinition =>
	isRecord(value) &&
	value["definitionType"] === "ryot:sandbox-script" &&
	isRecord(value["manifest"]) &&
	typeof value["run"] === "function" &&
	Schema.isSchema(value["input"]) &&
	Schema.isSchema(value["output"]);

const importCompiledModule = (specifier: string) => {
	if (boundRegExpExec(/^ryot-module:\/[a-f0-9]{64}\.js$/, specifier) === null) {
		return Effect.fail({
			phase: "load",
			error: "Compiled sandbox module specifier is invalid",
		} satisfies RunnerPhaseFailure);
	}
	return Effect.tryPromise({
		try: () => import(specifier),
		catch: (error) => ({ error, phase: "load" }) satisfies RunnerPhaseFailure,
	});
};

const createLazyJournalReader = (
	invocation: SandboxInvocation,
	bridge: SandboxInvocationBridge,
): WorkflowReplayJournal | undefined => {
	const journal = invocation.journal;
	if (!journal) {
		return undefined;
	}
	let reads = 0;
	let reservedReads = 0;
	let decodedBytes = 0;
	let reservedReadBytes = 0;

	const read = (index: number): Effect.Effect<WorkflowReplayJournalEntry, SandboxHostError> =>
		Effect.suspend(() => {
			const start = journal.offsets[index];
			const end = journal.offsets[index + 1];
			if (
				index < 0 ||
				index >= journal.length ||
				start === undefined ||
				end === undefined ||
				end <= start
			) {
				return Effect.fail(
					createFailure("Sandbox workflow journal index is outside its pinned prefix"),
				);
			}
			const entryBytes = end - start;
			const estimatedReads = mathCeil(entryBytes / journalReads.sliceBytes);
			if (
				reservedReads + estimatedReads > journalReads.count ||
				reservedReadBytes + entryBytes > journalReads.totalBytes
			) {
				return Effect.fail(
					createFailure("Sandbox workflow journal entry exceeds its reserved replay budget"),
				);
			}
			reservedReads += estimatedReads;
			reservedReadBytes += entryBytes;
			const bytes = new nativeUint8Array(entryBytes);
			const readRange = (position: number): Effect.Effect<void, SandboxHostError> =>
				Effect.suspend(() => {
					if (position >= end) {
						return Effect.void;
					}
					const length = mathMin(
						journalReads.sliceBytes,
						end - position,
						journalReads.totalBytes - decodedBytes,
					);
					if (length < 1 || reads >= journalReads.count) {
						return Effect.fail(createFailure("Sandbox workflow journal read budget exceeded"));
					}
					const args = { length, offset: position };
					reads += 1;
					return Effect.tryPromise({
						catch: asSandboxHostError,
						try: () => bridge.call("journalRead", jsonClone(args, "Journal read arguments")),
					}).pipe(
						Effect.flatMap((response) =>
							decodeJournalReadResult(response).pipe(
								Effect.mapError((error) =>
									createFailure(
										"Sandbox workflow journal range is invalid: " + nativeString(error),
									),
								),
							),
						),
						Effect.flatMap((response) => {
							if (response.offset !== position || response.totalBytes !== journal.totalBytes) {
								return Effect.fail(
									createFailure("Sandbox workflow journal range identity mismatch"),
								);
							}
							const chunkBytes = base64DecodedLength(response.data);
							if (
								chunkBytes === 0 ||
								chunkBytes > length ||
								decodedBytes + chunkBytes > journalReads.totalBytes
							) {
								return Effect.fail(
									createFailure("Sandbox workflow journal range length is invalid"),
								);
							}
							if (!decodeBase64Into(response.data, bytes, position - start)) {
								return Effect.fail(createFailure("Sandbox bridge returned invalid base64"));
							}
							decodedBytes += chunkBytes;
							return readRange(position + chunkBytes);
						}),
					);
				});

			return readRange(start).pipe(
				Effect.flatMap(() => {
					let parsed: unknown;
					try {
						let text: string;
						try {
							text = decodeJournalText(bytes);
						} finally {
							releaseBytes(bytes);
						}
						parsed = jsonParse(text);
					} catch (error) {
						return Effect.fail(
							createFailure("Sandbox workflow journal entry is invalid: " + nativeString(error)),
						);
					}
					return decodeJournalEntry(parsed).pipe(
						Effect.mapError((error) =>
							createFailure("Sandbox workflow journal entry is invalid: " + nativeString(error)),
						),
						Effect.filterOrFail(
							(entry) => entry.request.index === index,
							() => createFailure("Sandbox workflow journal entry index mismatch"),
						),
					);
				}),
			);
		});

	return { read, length: journal.length };
};

const canonicalExecutionMetadata = (metadata: SandboxInvocation["metadata"]) =>
	decodeExecutionMetadata({
		capabilities: metadata.capabilities,
		runtimeImports: metadata.runtimeImports,
		oauthConnectionFields: metadata.oauthConnectionFields,
		executableDependencies: metadata.executableDependencies,
		requiredPluginConfigKeys: metadata.requiredPluginConfigKeys,
		optionalPluginConfigKeys: metadata.optionalPluginConfigKeys,
	});

const createFilesystemBinding = (
	invocation: SandboxInvocation,
	bridge: SandboxInvocationBridge,
) => {
	const grants = invocation.filesystem;
	const artifactHintFailure = (key?: string): SandboxHostError | undefined => {
		if (
			!grants ||
			(key === undefined ? !grants.artifact : !includesArray(grants.namedArtifacts, key))
		) {
			return missingGrant(
				key === undefined
					? "Sandbox artifact grant is unavailable"
					: `Sandbox named artifact grant "${key}" is unavailable`,
				key === undefined ? "readArtifactRange" : "readNamedArtifact",
			);
		}
		return undefined;
	};

	const loadRange = Effect.fnUntraced(function* (offset: number, length: number, key?: string) {
		const args = yield* Schema.decodeEffect(
			artifactReadRangeArgsSchema,
			strictOptions,
		)({ ...(key === undefined ? {} : { key }), offset, length });
		const hintFailure = artifactHintFailure(key);
		if (hintFailure) {
			return yield* Effect.fail(hintFailure);
		}
		const response = yield* Effect.tryPromise({
			catch: asSandboxHostError,
			try: () => bridge.call("artifactReadRange", jsonClone(args, "Artifact range arguments")),
		});
		const range = yield* decodeArtifactReadRangeResult(response).pipe(
			Effect.mapError((error) =>
				createFailure("Sandbox artifact range is invalid: " + nativeString(error)),
			),
		);
		if (range.offset !== offset) {
			return yield* Effect.fail(
				createFailure("Sandbox artifact range is outside its memory grant"),
			);
		}
		const byteLength = base64DecodedLength(range.data);
		const remainingBytes = range.size > offset ? range.size - offset : 0;
		if (byteLength > length || byteLength > remainingBytes) {
			return yield* Effect.fail(createFailure("Sandbox artifact range length is invalid"));
		}
		return { byteLength, data: range.data, size: range.size };
	});

	const readRange = Effect.fnUntraced(function* (offset: number, length: number, key?: string) {
		const range = yield* loadRange(offset, length, key);
		const bytes = new nativeUint8Array(range.byteLength);
		yield* decodeRangeInto(range.data, bytes, 0);
		return { bytes, size: range.size };
	});

	const readWholeArtifact = Effect.fnUntraced(function* (key?: string) {
		const first = yield* loadRange(0, MiB, key);
		if (first.size > SANDBOX_LIMITS.isolate.externalBytes) {
			return yield* Effect.fail(
				createFailure("Sandbox artifact exceeds its reserved isolate memory"),
			);
		}
		const bytes = new nativeUint8Array(first.size);
		yield* decodeRangeInto(first.data, bytes, 0);
		let offset = first.byteLength;
		while (offset < first.size) {
			const range = yield* loadRange(offset, mathMin(MiB, first.size - offset), key);
			if (range.size !== first.size || range.byteLength === 0) {
				return yield* Effect.fail(createFailure("Sandbox artifact range is incomplete"));
			}
			yield* decodeRangeInto(range.data, bytes, offset);
			offset += range.byteLength;
		}
		return bytes;
	});

	const writeScratch = Effect.fnUntraced(function* (args: typeof scratchWriteArgsSchema.Type) {
		const response = yield* Effect.tryPromise({
			catch: asSandboxHostError,
			try: () => bridge.call("scratchWrite", args),
		});
		if (response !== null) {
			const result = yield* decodeHostResult(response);
			return yield* Effect.fail(
				result.success
					? createFailure("Sandbox scratch write result is invalid")
					: createFailure(result.error, result.data),
			);
		}
		return undefined;
	});

	return {
		readArtifact: () => Effect.runPromise(readWholeArtifact()),
		readNamedArtifact: (key: string) => Effect.runPromise(readWholeArtifact(key)),
		readArtifactRange: (offset: number, length: number, key?: string) =>
			Effect.runPromise(readRange(offset, length, key)),
		writeScratchChunks: (
			chunks: ReadonlyArray<{ readonly name: string; readonly contents: Uint8Array }>,
		) =>
			Effect.runPromise(
				Effect.gen(function* () {
					if (!grants?.scratch) {
						return yield* Effect.fail(
							missingGrant("Sandbox scratch grant is unavailable", "writeScratchChunks"),
						);
					}
					const names: string[] = [];
					for (let index = 0; index < chunks.length; index += 1) {
						const chunk = chunks[index];
						if (
							chunk === undefined ||
							chunk.name.length === 0 ||
							chunk.name === "." ||
							chunk.name === ".." ||
							stringContains(chunk.name, "/") ||
							stringContains(chunk.name, "\\") ||
							stringContains(chunk.name, "\0") ||
							!(chunk.contents instanceof nativeUint8Array) ||
							includesArray(names, chunk.name)
						) {
							return yield* Effect.fail(
								createFailure("Sandbox scratch chunk names must be unique plain file names"),
							);
						}
						pushArray(names, chunk.name);
					}
					for (let index = 0; index < chunks.length; index += 1) {
						const chunk = chunks[index];
						if (chunk === undefined) {
							continue;
						}
						if (chunk.contents.byteLength === 0) {
							yield* writeScratch(
								yield* decodeScratchWriteArgs({
									data: "",
									offset: 0,
									final: true,
									name: chunk.name,
								}),
							);
							continue;
						}
						for (let offset = 0; offset < chunk.contents.byteLength; offset += scratchChunkBytes) {
							const end = mathMin(chunk.contents.byteLength, offset + scratchChunkBytes);
							const data = encodeBase64(subarrayBytes(chunk.contents, offset, end));
							yield* writeScratch(
								yield* decodeScratchWriteArgs({
									data,
									offset,
									name: chunk.name,
									final: end === chunk.contents.byteLength,
								}),
							);
						}
					}
					return void 0;
				}),
			),
	};
};

const responseBytes = (value: unknown) => {
	const serialized = safeStringify(value);
	return typeof serialized === "string" ? bytesOf(serialized) : Number.POSITIVE_INFINITY;
};

const createHost = (
	invocation: SandboxInvocation,
	bridge: SandboxInvocationBridge,
	journal: WorkflowReplayJournal | undefined,
) => {
	const host: Record<string, unknown> = objectCreate(null);
	const budget: HostBudget = { http: 0, total: 0 };
	const callHost = (name: string, args: ReadonlyArray<unknown>) => {
		const budgetError = chargeHostCall(budget, name);
		if (budgetError) {
			return Effect.fail(budgetError);
		}
		const transported = transportArguments(name, args);
		if (!transported) {
			return Effect.fail(createFailure("requestEventStreamWork requires a script reference"));
		}
		let jsonArgs: JsonValue;
		try {
			jsonArgs = jsonClone(transported, name + " arguments");
		} catch (error) {
			return Effect.fail(asSandboxHostError(error));
		}
		if (responseBytes({ args: jsonArgs }) > SANDBOX_RUNNER_LIMITS.bridgeRequestBytes) {
			return Effect.fail(
				createFailure(
					"Sandbox bridge request exceeds " +
						SANDBOX_RUNNER_LIMITS.bridgeRequestBytes +
						" UTF-8 bytes",
				),
			);
		}
		return Effect.tryPromise({
			catch: asSandboxHostError,
			try: () => bridge.call(name, jsonArgs),
		}).pipe(
			Effect.flatMap((response) => {
				if (responseBytes(response) > SANDBOX_RUNNER_LIMITS.bridgeResponseBytes) {
					return Effect.fail(
						createFailure(
							"Sandbox bridge response exceeds " +
								SANDBOX_RUNNER_LIMITS.bridgeResponseBytes +
								" UTF-8 bytes",
						),
					);
				}
				return decodeHostResult(response).pipe(Effect.mapError(asSandboxHostError));
			}),
			Effect.flatMap((result) =>
				result.success
					? Effect.succeed(result.data)
					: Effect.fail(createFailure(result.error, result.data)),
			),
		);
	};

	if (journal) {
		host["replayJournal"] = () => Effect.succeed(journal);
	}
	for (let index = 0; index < invocation.apiFunctions.length; index += 1) {
		const name = invocation.apiFunctions[index];
		if (name === undefined || name === "replayJournal") {
			continue;
		}
		host[name] = (...args: unknown[]) => callHost(name, args);
	}
	return host;
};

type DurableCall = {
	started: boolean;
	settled: boolean;
	readonly request: Schema.Schema.Type<typeof workflowDurableCallRequestSchema>;
};

const createDurableHost = (
	invocation: SandboxInvocation,
	executionMetadata: Schema.Schema.Type<typeof SandboxExecutionMetadata>,
	bridge: SandboxInvocationBridge,
	journal: WorkflowReplayJournal,
) => {
	const transportHost = createHost(invocation, bridge, journal);
	const requests: Array<Schema.Schema.Type<typeof workflowDurableCallRequestSchema>> = [];
	const calls: DurableCall[] = [];
	const inlineValues: Array<JsonValue | undefined> = [];
	const inlineCapabilities = invocation.inlineDurableCapabilities ?? [];
	const budget: HostBudget = { http: 0, total: 0 };
	let pendingObserved = false;
	let settledJournalLength = journal.length;

	const settleInline = () =>
		Effect.suspend(() => {
			const batch = sliceArray(requests, settledJournalLength);
			if (batch.length === 0) {
				return Effect.succeed(false);
			}
			const inlineRequests: Array<Schema.Schema.Type<typeof workflowHostRequestSchema>> = [];
			for (let index = 0; index < batch.length; index += 1) {
				const request = batch[index];
				if (
					request?.kind !== "host" ||
					!includesArray(inlineCapabilities, request.args.capability)
				) {
					return Effect.succeed(false);
				}
				pushArray(inlineRequests, request);
			}
			const decoded = Schema.decodeUnknownResult(
				InlineBatchSchema,
				strictOptions,
			)({ requests: inlineRequests });
			if (decoded._tag === "Failure") {
				return Effect.die(decoded.failure);
			}
			if (
				responseBytes({ inline: decoded.success }) + 1 >
				SANDBOX_RUNNER_LIMITS.bridgeRequestBytes
			) {
				return Effect.succeed(false);
			}
			let rawReply: JsonValue;
			try {
				rawReply = bridge.inlineBatch(jsonClone(decoded.success, "Sandbox inline durable batch"));
			} catch (error) {
				return Effect.die(error);
			}
			return Schema.decodeUnknownEffect(
				InlineBatchReplySchema,
				strictOptions,
			)(rawReply).pipe(
				Effect.orDie,
				Effect.flatMap((reply) => {
					if ("defer" in reply) {
						return Effect.succeed(false);
					}
					if (reply.results.length !== inlineRequests.length) {
						return Effect.die(
							new nativeError("Sandbox inline durable results do not match the batch"),
						);
					}
					for (let offset = 0; offset < inlineRequests.length; offset += 1) {
						const result = reply.results[offset];
						if (result !== undefined) {
							inlineValues[settledJournalLength + offset] = result;
						}
					}
					settledJournalLength += inlineRequests.length;
					return Effect.succeed(true);
				}),
			);
		});

	const register = <Output extends Schema.ConstraintDecoder<unknown>>(
		requestValue: unknown,
		index: number,
		output?: Output,
	): Effect.Effect<unknown, unknown, Output["DecodingServices"]> => {
		if (pendingObserved) {
			return Effect.fail(durablePending);
		}
		const decodedRequest = Schema.decodeUnknownResult(
			workflowDurableCallRequestSchema,
			strictOptions,
		)(requestValue);
		if (decodedRequest._tag === "Failure") {
			return Effect.fail(decodedRequest.failure);
		}
		const request = decodedRequest.success;
		const call: DurableCall = { request, started: false, settled: false };
		pushArray(calls, call);
		pushArray(requests, request);
		return Effect.gen(function* () {
			call.started = true;
			let value: JsonValue | undefined;
			if (index < journal.length) {
				const entry = yield* journal.read(index);
				if (stableJson(entry.request) !== stableJson(request)) {
					return yield* Effect.fail(
						createFailure("Sandbox durable journal identity mismatch at index " + index),
					);
				}
				value = entry.value;
			} else {
				value = inlineValues[index];
				if (value === undefined) {
					yield* settleInline();
					value = inlineValues[index];
				}
			}
			if (value === undefined) {
				pendingObserved = true;
				call.settled = true;
				yield* Effect.yieldNow;
				return yield* Effect.fail(durablePending);
			}
			const result = yield* decodeDurableResult(value).pipe(
				Effect.mapError((error) =>
					createFailure("Recorded sandbox durable result is invalid: " + nativeString(error)),
				),
			);
			call.settled = true;
			if (result.state === "failure") {
				return yield* Effect.fail(result.error);
			}
			if (!output) {
				return result.value;
			}
			return yield* Schema.decodeEffect(output)(result.value).pipe(
				Effect.mapError((error) =>
					createFailure("Recorded workflow child output is invalid: " + nativeString(error)),
				),
			);
		});
	};

	const host: Record<string, unknown> = objectCreate(null);
	for (let index = 0; index < executionMetadata.capabilities.length; index += 1) {
		const name = executionMetadata.capabilities[index];
		if (name === undefined || name === "artifact-read" || name === "scratch") {
			continue;
		}
		if (name === "log" || name === "span") {
			const diagnostic = transportHost[name];
			if (typeof diagnostic === "function") {
				host[name] = diagnostic;
			}
			continue;
		}
		host[name] = (...args: unknown[]) => {
			const budgetError = chargeHostCall(budget, name);
			if (budgetError) {
				return Effect.fail(budgetError);
			}
			const transported = transportArguments(name, args);
			if (!transported) {
				return Effect.fail(createFailure("requestEventStreamWork requires a script reference"));
			}
			const requestIndex = requests.length;
			return register(
				{
					name,
					kind: "host",
					index: requestIndex,
					args: { capability: name, args: jsonClone(transported, name + " arguments") },
				},
				requestIndex,
			);
		};
	}
	objectDefineProperty(host, "executeWorkflow", {
		value: (name: unknown, reference: unknown, input: unknown) => {
			if (typeof name !== "string" || name.length === 0 || !isDurableWorkflowReference(reference)) {
				return Effect.fail(
					createFailure("executeWorkflow requires a name and workflow reference", {
						operation: "executeWorkflow",
						code: "invalid-executable-target",
					}),
				);
			}
			const decodedInput = Schema.decodeUnknownResult(reference.input, strictOptions)(input);
			if (decodedInput._tag === "Failure") {
				return Effect.fail(
					createFailure("executeWorkflow input is invalid: " + nativeString(decodedInput.failure)),
				);
			}
			const budgetError = chargeHostCall(budget, "executeWorkflow");
			if (budgetError) {
				return Effect.fail(budgetError);
			}
			const index = requests.length;
			return register(
				{
					name,
					index,
					kind: "workflow-child",
					args: {
						workflowSlug: reference.workflowSlug,
						input: jsonClone(decodedInput.success, "executeWorkflow input"),
					},
				},
				index,
				reference.output,
			);
		},
	});

	return {
		host,
		requests,
		journalLength: journal.length,
		isPending: () => pendingObserved,
		detachedError: () =>
			someArray(calls, (call: DurableCall) => !call.started || !call.settled)
				? "Sandbox body returned with detached or in-flight durable host work"
				: undefined,
		startedRequests: () => {
			const started: Array<Schema.Schema.Type<typeof workflowDurableCallRequestSchema>> = [];
			for (let index = 0; index < calls.length; index += 1) {
				const call = calls[index];
				if (call === undefined || !call.started) {
					break;
				}
				pushArray(started, call.request);
			}
			return started;
		},
	};
};

const isDurableWorkflowReference = (value: unknown): value is DurableWorkflowReference => {
	if (!isRecord(value)) {
		return false;
	}
	const workflowSlug = value["workflowSlug"];
	return (
		typeof workflowSlug === "string" &&
		workflowSlug.length > 0 &&
		Schema.isSchema(value["input"]) &&
		Schema.isSchema(value["output"])
	);
};

const executeDefinition = Effect.fnUntraced(function* (
	definitionValue: unknown,
	invocation: SandboxInvocation,
	metadata: Schema.Schema.Type<typeof SandboxExecutionMetadata>,
	bridge: SandboxInvocationBridge,
	journal: WorkflowReplayJournal | undefined,
	setPhase: (phase: SandboxRunnerPhase) => void,
) {
	if (!isRecord(definitionValue)) {
		return yield* Effect.fail({
			phase: "load",
			error: "Compiled sandbox module must have a default definition export",
		} satisfies RunnerPhaseFailure);
	}
	if (!isSandboxDefinition(definitionValue)) {
		return yield* Effect.fail({
			phase: "load",
			error: "Compiled sandbox module has an invalid script definition",
		} satisfies RunnerPhaseFailure);
	}
	const manifest = yield* decodeManifest(definitionValue.manifest).pipe(
		Effect.mapError(
			(error) =>
				({
					phase: "load",
					error: "Compiled sandbox manifest is invalid: " + nativeString(error),
				}) satisfies RunnerPhaseFailure,
		),
	);
	if (!manifestsMatch(manifest, invocation.metadata)) {
		return yield* Effect.fail({
			phase: "load",
			error: "Compiled sandbox manifest does not match persisted metadata",
		} satisfies RunnerPhaseFailure);
	}

	setPhase("input");
	const parsedInput = yield* Schema.decodeEffect(definitionValue.input)(invocation.context).pipe(
		Effect.mapError(
			(error) =>
				({
					phase: "input",
					error: "Definition input validation failed: " + nativeString(error),
				}) satisfies RunnerPhaseFailure,
		),
	);

	setPhase("execute");
	let durable: ReturnType<typeof createDurableHost> | undefined;
	if (invocation.workflowExecutionId !== undefined && manifest.kind !== "workflow") {
		if (!journal) {
			return yield* Effect.fail({
				phase: "input",
				error: "Sandbox workflow journal is unavailable",
			} satisfies RunnerPhaseFailure);
		}
		durable = createDurableHost(invocation, metadata, bridge, journal);
	}
	const host = durable?.host ?? createHost(invocation, bridge, journal);
	const execution = yield* Effect.try({
		catch: (error) => ({ error, phase: "execute" }) satisfies RunnerPhaseFailure,
		try: () =>
			definitionValue.run(parsedInput, host, {
				metadata: invocation.metadata,
				startedAt: invocation.startedAt,
				sandboxScriptId: invocation.scriptId,
			}),
	});
	if (!Effect.isEffect(execution)) {
		return yield* Effect.fail({
			phase: "execute",
			error: "Sandbox definition must return an Effect",
		} satisfies RunnerPhaseFailure);
	}
	const millis = nativeDateParse(invocation.startedAt);
	if (!numberIsFinite(millis)) {
		return yield* Effect.fail({
			phase: "input",
			error: "Sandbox invocation startedAt is invalid",
		} satisfies RunnerPhaseFailure);
	}
	const nanos = nativeBigInt(millis) * 1_000_000n;
	const clock = yield* Clock.Clock;
	const outcome = yield* Effect.match(execution, {
		onSuccess: (value) => ({ value, success: true as const }),
		onFailure: (error) => ({ error, success: false as const }),
	}).pipe(
		Effect.provideService(Clock.Clock, {
			currentTimeNanosUnsafe: () => nanos,
			currentTimeMillisUnsafe: () => millis,
			currentTimeNanos: Effect.succeed(nanos),
			currentTimeMillis: Effect.succeed(millis),
			sleep: (duration) => clock.sleep(duration),
			monotonicTimeNanos: clock.monotonicTimeNanos,
			monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
		}),
	);

	if (durable) {
		if (durable.isPending()) {
			return { state: "pending", requests: durable.requests, journalLength: durable.journalLength };
		}
		const detachedError = durable.detachedError();
		if (detachedError) {
			return {
				state: "failed",
				error: detachedError,
				kind: "script-failure",
				requests: durable.startedRequests(),
				journalLength: durable.journalLength,
			};
		}
		if (!outcome.success) {
			return {
				state: "failed",
				requests: durable.requests,
				error: errorMessage(outcome.error),
				journalLength: durable.journalLength,
				kind: hostFailureKind(outcome.error) ?? "script-failure",
			};
		}
		setPhase("output");
		const decodedOutput = Schema.decodeUnknownEffect(definitionValue.output)(outcome.value).pipe(
			Effect.flatMap((decoded) =>
				Effect.try({
					try: () => jsonClone(decoded, "Definition output"),
					catch: (error) =>
						createFailure("Definition output validation failed: " + nativeString(error)),
				}),
			),
		);
		const outputResult = yield* Effect.match(decodedOutput, {
			onSuccess: (value) => ({ value, success: true as const }),
			onFailure: (error) => ({ error, success: false as const }),
		});
		if (!outputResult.success) {
			return {
				state: "failed",
				kind: "invalid-output",
				requests: durable.requests,
				journalLength: durable.journalLength,
				error: errorMessage(outputResult.error),
			};
		}
		return {
			state: "completed",
			requests: durable.requests,
			output: outputResult.value,
			journalLength: durable.journalLength,
		};
	}

	if (!outcome.success) {
		const kind = hostFailureKind(outcome.error);
		return yield* Effect.fail({
			phase: "execute",
			error: outcome.error,
			...(kind === undefined ? {} : { kind }),
		} satisfies RunnerPhaseFailure);
	}
	setPhase("output");
	return yield* Schema.decodeUnknownEffect(definitionValue.output)(outcome.value).pipe(
		Effect.mapError(
			(error) =>
				({
					phase: "output",
					error: "Definition output validation failed: " + nativeString(error),
				}) satisfies RunnerPhaseFailure,
		),
	);
});

const serializeResponse = (response: SandboxInvocationResponse) => {
	const serialized = jsonStringify(decodeInvocationResponse(response));
	if (typeof serialized !== "string") {
		throw new nativeError("Sandbox invocation response is not JSON-serializable");
	}
	return serialized;
};

type ConsoleMethods = Record<(typeof consoleMethods)[number], (...args: unknown[]) => void>;

type InvocationState = {
	readonly startedAt: number;
	readonly previousConsole: ConsoleMethods;
	phase: SandboxRunnerPhase;
	invocation?: SandboxInvocation;
	logs: SandboxLogCollector;
	restoreWorkflowGlobals?: () => void;
};

const installConsole = (methods: ConsoleMethods) => {
	for (let index = 0; index < consoleMethods.length; index += 1) {
		const name = consoleMethods[index];
		if (name !== undefined) {
			console[name] = methods[name];
		}
	}
};

const isRunnerPhase = (
	value: Record<string, unknown>,
): value is Record<string, unknown> & RunnerPhaseFailure => {
	if (
		(value["phase"] !== "load" &&
			value["phase"] !== "input" &&
			value["phase"] !== "execute" &&
			value["phase"] !== "output") ||
		!hasOwn(value, "error")
	) {
		return false;
	}
	if (!hasOwn(value, "kind")) {
		return true;
	}
	return Schema.decodeUnknownResult(SandboxFailureKind)(value["kind"])._tag === "Success";
};

const failureResponse = (error: unknown, state: InvocationState, specifier: string) => {
	const phaseFailure = isRecord(error) && isRunnerPhase(error) ? error : undefined;
	const phase = phaseFailure?.phase ?? state.phase;
	const runnerError = executionError(
		phaseFailure?.error ?? error,
		phase,
		state.invocation,
		specifier,
		phaseFailure?.kind ?? phaseFailureKinds[phase],
	);
	try {
		return serializeResponse({
			success: false,
			error: runnerError,
			logs: state.logs.logs,
			timing: { executionMs: performanceNow() - state.startedAt },
		});
	} catch {
		return (
			'{"success":false,"logs":[],"error":' +
			jsonStringify(runnerError) +
			',"timing":{"executionMs":0}}'
		);
	}
};

const runInvocation = Effect.fnUntraced(function* (
	state: InvocationState,
	specifier: string,
	input: string,
	bridge: SandboxInvocationBridge,
) {
	if (bytesOf(input) > maxInvocationBytes) {
		return yield* Effect.fail({
			phase: "input",
			error: "Sandbox runner request exceeds " + maxInvocationBytes + " UTF-8 bytes",
		} satisfies RunnerPhaseFailure);
	}
	const invocation = yield* decodeInvocation(input).pipe(
		Effect.mapError((error) => ({ error, phase: "input" }) satisfies RunnerPhaseFailure),
	);
	state.invocation = invocation;
	state.logs = createLogCollector(SANDBOX_RUNNER_LIMITS);
	installConsole(state.logs.console);
	filesystemBinding = createFilesystemBinding(invocation, bridge);
	disableCodeGeneration();
	state.phase = "load";
	approvedDependencyRuntime.configure(invocation);
	const metadata = yield* canonicalExecutionMetadata(invocation.metadata).pipe(
		Effect.mapError((error) => ({ error, phase: "load" }) satisfies RunnerPhaseFailure),
	);
	const journal = createLazyJournalReader(invocation, bridge);
	if (invocation.workflowExecutionId !== undefined || invocation.metadata.kind === "workflow") {
		state.restoreWorkflowGlobals = installWorkflowDeterminismGuard();
	}
	const module = yield* importCompiledModule(specifier);
	const value = yield* executeDefinition(
		module.default,
		invocation,
		metadata,
		bridge,
		journal,
		(phase) => {
			state.phase = phase;
		},
	);
	state.phase = "output";
	const jsonValue = yield* decodeJsonValue(value ?? null).pipe(
		Effect.mapError((error) => ({ error, phase: "output" }) satisfies RunnerPhaseFailure),
	);
	const serializedValue = jsonStringify(jsonValue);
	if (typeof serializedValue !== "string") {
		return yield* Effect.fail({
			phase: "output",
			error: "Sandbox definition result is not JSON-serializable",
		} satisfies RunnerPhaseFailure);
	}
	if (bytesOf(serializedValue) > SANDBOX_RUNNER_LIMITS.resultBytes) {
		return yield* Effect.fail({
			phase: "output",
			error:
				"Sandbox definition result exceeds " + SANDBOX_RUNNER_LIMITS.resultBytes + " UTF-8 bytes",
		} satisfies RunnerPhaseFailure);
	}
	return serializeResponse({
		success: true,
		value: jsonValue,
		logs: state.logs.logs,
		timing: { executionMs: performanceNow() - state.startedAt },
	});
});

// oxlint-disable-next-line effecttsgo/async-function -- The native isolate entrypoint returns a Promise by contract.
export const executeSandboxInvocation = async (
	specifier: string,
	input: string,
	bridge: SandboxInvocationBridge,
): Promise<string> => {
	const state: InvocationState = {
		phase: "input",
		startedAt: performanceNow(),
		logs: {
			logs: [],
			console: { log: () => {}, info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
		},
		previousConsole: {
			log: console.log,
			info: console.info,
			warn: console.warn,
			debug: console.debug,
			error: console.error,
		},
	};
	try {
		return await Effect.runPromise(
			runInvocation(state, specifier, input, bridge).pipe(
				Effect.catch((error) => Effect.succeed(failureResponse(error, state, specifier))),
			),
		);
	} catch (error) {
		return failureResponse(error, state, specifier);
	} finally {
		filesystemBinding = undefined;
		state.restoreWorkflowGlobals?.();
		installConsole(state.previousConsole);
	}
};

objectDefineProperty(globalThis, "__ryotDefinitionRunner", {
	configurable: true,
	value: executeSandboxInvocation,
});
