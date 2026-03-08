import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

import {
	createLogCollector,
	executionError,
	failurePhase,
	isRecord,
	readBridgeResponse,
	type SandboxLogCollector,
	type SandboxRunnerPayload,
	throwPhase,
	validateLimits,
} from "./runner-utilities.sandbox.ts";

type HostBudget = { http: number; total: number };
type SandboxHostError = { readonly message: string; readonly data?: unknown };
type ServiceFreeSchema = Schema.ConstraintDecoder<unknown>;
type SandboxDefinition<
	Input extends ServiceFreeSchema = ServiceFreeSchema,
	Output extends ServiceFreeSchema = ServiceFreeSchema,
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

const reflectGet = Reflect.get;
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const nativeDate = globalThis.Date;
const arrayIsArray = Array.isArray;
const nativeError = globalThis.Error;
nativeError.stackTraceLimit = Infinity;
const createDictionary = Object.create;
const nativeString = globalThis.String;
const readFile = Deno.readFile.bind(Deno);
const nativeFunction = globalThis.Function;
const reflectConstruct = Reflect.construct;
const writeFile = Deno.writeFile.bind(Deno);
const defineProperty = Object.defineProperty;
const setPrototypeOf = Object.setPrototypeOf;
const deleteProperty = Reflect.deleteProperty;
const nativeUint8Array = globalThis.Uint8Array;
const jsonParse = JSON.parse.bind(JSON);
const readStdin = Deno.stdin.read.bind(Deno.stdin);
const encodeComponent = globalThis.encodeURIComponent;
const writeStdout = Deno.stdout.write.bind(Deno.stdout);
const encodeText = encoder.encode.bind(encoder);
const decodeText = decoder.decode.bind(decoder);
const jsonStringify = JSON.stringify.bind(JSON);
const bridgeFetch = globalThis.fetch.bind(globalThis);
const exitDeno: (code?: number) => never = Deno.exit.bind(Deno);
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const performanceNow = performance.now.bind(performance);
const filesystemKey = Symbol.for("@ryot/sandbox-sdk/filesystem");
const generatorFunction = Object.getPrototypeOf(function* () {}).constructor as Function;
const asyncFunction = Object.getPrototypeOf(async function () {}).constructor as Function;
const stringIncludes = String.prototype.includes.call.bind(String.prototype.includes);
const asyncGeneratorFunction = Object.getPrototypeOf(async function* () {}).constructor as Function;

const strictStruct = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
	Schema.Struct(fields).annotate({ parseOptions: { onExcessProperty: "error" as const } });
const hostResultSchema = Schema.Union([
	strictStruct({
		error: Schema.String,
		success: Schema.Literal(false),
		data: Schema.optional(Schema.Unknown),
	}),
	strictStruct({
		data: Schema.Unknown.pipe(
			Schema.check(
				Schema.makeFilter((value) => value !== undefined || "Host result data is required"),
			),
		),
		success: Schema.Literal(true),
	}),
]);
const decodeHostResult = Schema.decodeUnknownEffect(hostResultSchema);

let buffer = "";

const installFilesystem = (payload: SandboxRunnerPayload) => {
	const artifactPath = payload.filesystem?.artifactPath;
	const scratchDirectory = payload.filesystem?.scratchDirectory;
	const namedArtifactPaths = payload.filesystem?.namedArtifactPaths;
	defineProperty(globalThis, filesystemKey, {
		enumerable: false,
		configurable: true,
		value: {
			readArtifact: () => {
				if (!artifactPath) {
					return Promise.reject(new nativeError("Sandbox artifact grant is unavailable"));
				}
				return readFile(artifactPath);
			},
			readNamedArtifact: (key: string) => {
				const namedArtifactPath = namedArtifactPaths?.[key];
				if (!namedArtifactPath) {
					return Promise.reject(
						new nativeError(`Sandbox named artifact grant "${key}" is unavailable`),
					);
				}
				return readFile(namedArtifactPath);
			},
			writeScratchChunks: async (chunks: unknown) => {
				if (!scratchDirectory) {
					throw new nativeError("Sandbox scratch grant is unavailable");
				}
				if (!arrayIsArray(chunks)) {
					throw new nativeError("Sandbox scratch chunks must be an array");
				}
				const names: string[] = [];
				for (const chunk of chunks) {
					if (
						!isRecord(chunk) ||
						typeof chunk.name !== "string" ||
						chunk.name.length === 0 ||
						chunk.name === "." ||
						chunk.name === ".." ||
						stringIncludes(chunk.name, "/") ||
						stringIncludes(chunk.name, "\\") ||
						stringIncludes(chunk.name, "\0") ||
						!(chunk.contents instanceof nativeUint8Array)
					) {
						throw new nativeError("Sandbox scratch chunk names must be plain file names");
					}
					for (const name of names) {
						if (name === chunk.name) {
							throw new nativeError(`Duplicate sandbox scratch chunk name "${chunk.name}"`);
						}
					}
					names.push(chunk.name);
					await writeFile(`${scratchDirectory}/${chunk.name}`, chunk.contents);
				}
			},
		},
	});
};

const disableCodeGeneration = () => {
	for (const name of ["Deno", "eval", "Function", "Worker", "SharedWorker"]) {
		if (name in globalThis) {
			defineProperty(globalThis, name, {
				writable: false,
				value: undefined,
				enumerable: false,
				configurable: false,
			});
		}
	}
	for (const constructor of [
		nativeFunction,
		asyncFunction,
		generatorFunction,
		asyncGeneratorFunction,
	]) {
		defineProperty(constructor.prototype, "constructor", {
			writable: false,
			value: undefined,
			enumerable: false,
			configurable: false,
		});
	}
};

const installWorkflowDeterminismGuard = () => {
	const restore: Array<() => void> = [];
	const blocked = (name: string) => () => {
		throw new nativeError("Workflow code cannot use ambient nondeterminism: " + name);
	};
	const replace = (target: object, name: PropertyKey, replacement: PropertyDescriptor) => {
		const descriptor = getOwnPropertyDescriptor(target, name);
		defineProperty(target, name, {
			...replacement,
			configurable: true,
			enumerable: descriptor?.enumerable ?? false,
		});
		restore.push(() => {
			if (descriptor) {
				defineProperty(target, name, descriptor);
			} else {
				deleteProperty(target, name);
			}
		});
	};
	const dateNow = () => 0;
	const workflowDate = function (...args: unknown[]) {
		if (!new.target) {
			throw new nativeError("Workflow code cannot call ambient Date()");
		}
		if (args.length === 0) {
			throw new nativeError(
				"Workflow code cannot construct an ambient current date with new Date()",
			);
		}
		return reflectConstruct(nativeDate, args, workflowDate);
	} as unknown as DateConstructor;
	setPrototypeOf(workflowDate.prototype, nativeDate.prototype);
	defineProperty(workflowDate, "now", { value: dateNow });
	defineProperty(workflowDate, "UTC", { value: nativeDate.UTC });
	defineProperty(workflowDate, "parse", { value: nativeDate.parse });

	try {
		replace(globalThis, "Date", { value: workflowDate });
		replace(Math, "random", { value: blocked("Math.random") });
		replace(crypto, "randomUUID", { value: blocked("crypto.randomUUID") });
		replace(crypto, "getRandomValues", { value: blocked("crypto.getRandomValues") });
		replace(performance, "now", { value: blocked("performance.now") });

		const temporal = reflectGet(globalThis, "Temporal");
		if (isRecord(temporal)) {
			const temporalNow = reflectGet(temporal, "Now");
			if (isRecord(temporalNow)) {
				const blockedTemporalNow = blocked("Temporal.Now");
				const workflowTemporalNow = new Proxy(temporalNow, {
					get: (target, name, receiver) => {
						const value = reflectGet(target, name, receiver);
						return typeof value === "function" ? blockedTemporalNow : value;
					},
				});
				replace(temporal, "Now", { value: workflowTemporalNow });
			}
		}
	} catch (error) {
		for (let index = restore.length - 1; index >= 0; index -= 1) {
			restore[index]?.();
		}
		throw error;
	}

	return () => {
		for (let index = restore.length - 1; index >= 0; index -= 1) {
			restore[index]?.();
		}
	};
};

async function readLine(): Promise<string> {
	const chunk = new Uint8Array(65536);
	for (;;) {
		const newlineIdx = buffer.indexOf("\n");
		if (newlineIdx !== -1) {
			const line = buffer.slice(0, newlineIdx);
			buffer = buffer.slice(newlineIdx + 1);
			return line;
		}
		const count = await readStdin(chunk);
		if (count === null) {
			exitDeno(0);
		}
		buffer += decodeText(chunk.subarray(0, count));
	}
}

const hostFailure = (error: string) => ({ error, success: false as const });

const sandboxHostError = (error: unknown): SandboxHostError => {
	const message =
		isRecord(error) && typeof error.message === "string" ? error.message : nativeString(error);
	return isRecord(error) && error.data !== undefined ? { message, data: error.data } : { message };
};

const transportHostCall =
	(fnName: string, payload: SandboxRunnerPayload, budget: HostBudget) =>
	async (args: readonly unknown[]): Promise<unknown> => {
		budget.total += 1;
		if (fnName === "httpCall") {
			budget.http += 1;
		}
		if (budget.total > payload.limits.hostCallCount) {
			return hostFailure(payload.limits.hostCallLimitMessage);
		}
		if (budget.http > payload.limits.httpCallCount) {
			return hostFailure(payload.limits.httpCallLimitMessage);
		}

		let requestBody: string;
		try {
			requestBody = jsonStringify({ args });
		} catch {
			return hostFailure("Sandbox bridge request is not valid JSON");
		}
		if (typeof requestBody !== "string") {
			return hostFailure("Sandbox bridge request is not valid JSON");
		}
		if (encodeText(requestBody).byteLength > payload.limits.bridgeRequestBytes) {
			return hostFailure(
				"Sandbox bridge request exceeds " + payload.limits.bridgeRequestBytes + " UTF-8 bytes",
			);
		}

		const response = await bridgeFetch(
			payload.apiBase +
				"/rpc/" +
				encodeComponent(payload.executionId) +
				"/" +
				encodeComponent(fnName),
			{
				method: "POST",
				body: requestBody,
				headers: { "Content-Type": "application/json", Authorization: "Bearer " + payload.token },
			},
		);
		const responseLimit =
			fnName === "durableCalls"
				? payload.limits.durableBridgeResponseBytes
				: payload.limits.bridgeResponseBytes;
		const responseBody = await readBridgeResponse(response, responseLimit);
		if (responseBody.oversized) {
			return hostFailure("Sandbox bridge response exceeds " + responseLimit + " UTF-8 bytes");
		}

		let body: { error?: string; result?: unknown };
		try {
			body = jsonParse(responseBody.body);
		} catch {
			throw new nativeError("Sandbox bridge returned invalid JSON");
		}
		if (!response.ok) {
			throw new nativeError(body.error ?? "API call failed");
		}
		return body.result;
	};

const createApiStub = (fnName: string, payload: SandboxRunnerPayload, budget: HostBudget) => {
	return (...args: unknown[]) =>
		Effect.tryPromise({
			try: () => transportHostCall(fnName, payload, budget)(args),
			catch: sandboxHostError,
		}).pipe(
			Effect.flatMap((result) => decodeHostResult(result).pipe(Effect.mapError(sandboxHostError))),
			Effect.flatMap((result) =>
				result.success
					? Effect.succeed(result.data)
					: Effect.fail(sandboxHostError({ message: result.error, data: result.data })),
			),
		);
};

const createHost = (payload: SandboxRunnerPayload) => {
	const approved = arrayIsArray(payload.apiFunctions) ? payload.apiFunctions : [];
	const budget: HostBudget = { http: 0, total: 0 };
	const host: Record<string, unknown> = createDictionary(null);
	for (let index = 0; index < approved.length; index += 1) {
		const fnName = approved[index];
		if (typeof fnName !== "string") {
			continue;
		}
		host[fnName] = createApiStub(fnName, payload, budget);
	}
	return host;
};

const durablePending = Symbol("sandbox-durable-call-pending");
type DurableCall = {
	started: boolean;
	settled: boolean;
	readonly request: Record<string, unknown>;
};
type DurableWorkflowReference = {
	readonly workflowSlug: string;
	readonly input: ServiceFreeSchema;
	readonly output: ServiceFreeSchema;
};

const isDurableWorkflowReference = (value: unknown): value is DurableWorkflowReference =>
	isRecord(value) &&
	typeof value.workflowSlug === "string" &&
	value.workflowSlug.length > 0 &&
	Schema.isSchema(value.input) &&
	Schema.isSchema(value.output);

const jsonClone = (value: unknown, label: string) => {
	let serialized: string | undefined;
	try {
		serialized = jsonStringify(value);
	} catch {
		throw new nativeError(label + " must be JSON-serializable");
	}
	if (typeof serialized !== "string") {
		throw new nativeError(label + " must be JSON-serializable");
	}
	return jsonParse(serialized) as unknown;
};

const stableJson = (value: unknown): string => {
	if (arrayIsArray(value)) {
		return "[" + value.map(stableJson).join(",") + "]";
	}
	if (isRecord(value)) {
		return (
			"{" +
			Object.keys(value)
				.sort()
				.map((key) => jsonStringify(key) + ":" + stableJson(value[key]))
				.join(",") +
			"}"
		);
	}
	return nativeString(jsonStringify(value));
};

const durableResult = (
	value: unknown,
	output?: ServiceFreeSchema,
): Effect.Effect<unknown, SandboxHostError | Error> => {
	if (!isRecord(value)) {
		return Effect.fail(new nativeError("Recorded sandbox durable result is invalid"));
	}
	if (value.state === "success" && "value" in value) {
		return output
			? Schema.decodeUnknownEffect(output)(value.value).pipe(
					Effect.mapError(
						(error) =>
							new nativeError("Recorded workflow child output is invalid: " + nativeString(error)),
					),
				)
			: Effect.succeed(value.value);
	}
	if (
		value.state === "failure" &&
		isRecord(value.error) &&
		typeof value.error.message === "string"
	) {
		return Effect.fail(
			value.error.data === undefined
				? { message: value.error.message }
				: { message: value.error.message, data: value.error.data },
		);
	}
	return Effect.fail(new nativeError("Recorded sandbox durable result is invalid"));
};

const createDurableHost = async (definition: SandboxDefinition, payload: SandboxRunnerPayload) => {
	const transportHost = createHost(payload);
	const bootstrap = transportHost.durableCalls;
	if (typeof bootstrap !== "function") {
		throw new nativeError("Durable sandbox replay bootstrap is unavailable");
	}
	const journal = await Effect.runPromise((bootstrap as () => Effect.Effect<unknown, unknown>)());
	if (!arrayIsArray(journal)) {
		throw new nativeError("Durable sandbox replay journal is invalid");
	}

	const calls: DurableCall[] = [];
	const requests: Array<Record<string, unknown>> = [];
	const budget: HostBudget = { http: 0, total: 0 };
	let pendingObserved = false;
	const consumeBudget = (capability: string) => {
		budget.total += 1;
		if (capability === "httpCall") {
			budget.http += 1;
		}
		return budget.total > payload.limits.hostCallCount
			? payload.limits.hostCallLimitMessage
			: budget.http > payload.limits.httpCallCount
				? payload.limits.httpCallLimitMessage
				: undefined;
	};
	const register = (
		request: Record<string, unknown>,
		index: number,
		output?: ServiceFreeSchema,
	) => {
		if (pendingObserved) {
			return Effect.fail(durablePending as unknown);
		}
		const call: DurableCall = { request, started: false, settled: false };
		calls.push(call);
		requests.push(request);
		return Effect.suspend(() => {
			call.started = true;
			const entry = journal[index];
			if (entry === undefined) {
				pendingObserved = true;
				call.settled = true;
				return Effect.yieldNow.pipe(Effect.andThen(Effect.fail(durablePending as unknown)));
			}
			call.settled = true;
			if (
				!isRecord(entry) ||
				!isRecord(entry.request) ||
				stableJson(entry.request) !== stableJson(request)
			) {
				return Effect.fail(
					new nativeError("Sandbox durable journal identity mismatch at index " + index),
				);
			}
			return durableResult(entry.value, output);
		});
	};
	const host: Record<string, unknown> = createDictionary(null);
	const capabilities = arrayIsArray(definition.manifest.capabilities)
		? definition.manifest.capabilities
		: [];
	for (let index = 0; index < capabilities.length; index += 1) {
		const capability = capabilities[index];
		if (typeof capability !== "string") {
			continue;
		}
		if (capability === "artifact-read" || capability === "scratch") {
			continue;
		}
		if (capability === "log" || capability === "span") {
			const diagnostic = transportHost[capability];
			if (typeof diagnostic === "function") {
				host[capability] = diagnostic;
			}
			continue;
		}
		host[capability] = (...args: unknown[]) => {
			const budgetError = consumeBudget(capability);
			if (budgetError) {
				return Effect.fail({ message: budgetError });
			}
			const index = requests.length;
			return register(
				{
					index,
					kind: "host",
					name: capability,
					args: { capability, args: jsonClone(args, capability + " arguments") },
				},
				index,
			);
		};
	}
	host.executeWorkflow = (name: unknown, reference: unknown, input: unknown) => {
		if (typeof name !== "string" || name.length === 0 || !isDurableWorkflowReference(reference)) {
			return Effect.fail({ message: "executeWorkflow requires a name and workflow reference" });
		}
		const decoded = Schema.decodeUnknownResult(reference.input)(input);
		if (decoded._tag === "Failure") {
			return Effect.fail({
				message: "executeWorkflow input is invalid: " + nativeString(decoded.failure),
			});
		}
		const budgetError = consumeBudget("executeWorkflow");
		if (budgetError) {
			return Effect.fail({ message: budgetError });
		}
		const index = requests.length;
		return register(
			{
				name,
				index,
				kind: "workflow-child",
				args: {
					workflowSlug: reference.workflowSlug,
					input: jsonClone(decoded.success, "executeWorkflow input"),
				},
			},
			index,
			reference.output,
		);
	};

	return {
		host,
		requests,
		journalLength: journal.length,
		isPending: () => pendingObserved,
		startedRequests: () => {
			const started: Array<Record<string, unknown>> = [];
			for (let index = 0; index < calls.length; index += 1) {
				const call = calls[index];
				if (!call?.started) {
					break;
				}
				started.push(call.request);
			}
			return started;
		},
		detachedError: () => {
			for (let index = 0; index < calls.length; index += 1) {
				const call = calls[index];
				if (call && (!call.started || !call.settled)) {
					return "Sandbox body returned with detached or in-flight durable host work";
				}
			}
			return undefined;
		},
	};
};

const serializeLogs = (logs: readonly string[]) => {
	let serialized = "[";
	for (let index = 0; index < logs.length; index += 1) {
		serialized += `${index === 0 ? "" : ","}${jsonStringify(logs[index])}`;
	}
	return serialized + "]";
};

const writeSuccess = async (
	logs: readonly string[],
	serializedValue: string,
	executionMs: number,
) => {
	const result = `{"success":true,"logs":${serializeLogs(logs)},"value":${serializedValue},"timing":{"executionMs":${executionMs}}}\n`;
	await writeStdout(encodeText(result));
};

const writeFailure = async (
	logs: readonly string[],
	error: { phase: string; message: string; line?: number; column?: number; stack?: string },
	executionMs: number,
) => {
	const serializedError = `{"phase":${jsonStringify(error.phase)},"message":${jsonStringify(error.message)}${error.line === undefined ? "" : `,"line":${error.line}`}${error.column === undefined ? "" : `,"column":${error.column}`}${error.stack === undefined ? "" : `,"stack":${jsonStringify(error.stack)}`}}`;
	const result = `{"success":false,"logs":${serializeLogs(logs)},"error":${serializedError},"timing":{"executionMs":${executionMs}}}\n`;
	await writeStdout(encodeText(result));
};

const stringArraysMatch = (left: unknown, right: unknown) => {
	if (!arrayIsArray(left) || !arrayIsArray(right) || left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index += 1) {
		if (typeof left[index] !== "string" || left[index] !== right[index]) {
			return false;
		}
	}
	return true;
};

const manifestsMatch = (left: unknown, right: unknown) =>
	isRecord(left) &&
	isRecord(right) &&
	left.kind === right.kind &&
	left.name === right.name &&
	left.slug === right.slug &&
	stringArraysMatch(left.capabilities, right.capabilities) &&
	stringArraysMatch(left.requiredPluginConfigKeys, right.requiredPluginConfigKeys) &&
	stringArraysMatch(left.requiredSystemConfigKeys, right.requiredSystemConfigKeys);

const importCompiledModule = async (
	payload: SandboxRunnerPayload,
): Promise<{ default: unknown }> => {
	if (payload.compiledFormat !== 1) {
		throwPhase(
			"load",
			"Unsupported sandbox compiled format: " + nativeString(payload.compiledFormat),
		);
	}
	if (
		typeof payload.moduleUrl !== "string" ||
		!payload.moduleUrl.startsWith("file:///") ||
		!/\/[a-f0-9]{64}\.mjs$/.test(payload.moduleUrl) ||
		payload.moduleUrl.includes("/../")
	) {
		throwPhase("load", "Compiled sandbox module path is invalid");
	}

	try {
		return await import(payload.moduleUrl);
	} catch (error) {
		return throwPhase("load", error);
	}
};

const isSandboxDefinition = (definition: unknown): definition is SandboxDefinition =>
	isRecord(definition) &&
	definition.definitionType === "ryot:sandbox-script" &&
	isRecord(definition.manifest) &&
	typeof definition.run === "function" &&
	Schema.isSchema(definition.input) &&
	Schema.isSchema(definition.output);

const executeDefinition = async (
	definition: unknown,
	payload: SandboxRunnerPayload,
	setPhase: (phase: string) => void,
): Promise<unknown> => {
	if (!isRecord(definition)) {
		return throwPhase("load", "Compiled sandbox module must have a default definition export");
	}
	if (!isSandboxDefinition(definition)) {
		return throwPhase("load", "Compiled sandbox module has an invalid script definition");
	}
	if (!manifestsMatch(definition.manifest, payload.metadata)) {
		return throwPhase("load", "Compiled sandbox manifest does not match persisted metadata");
	}
	const run = definition.run;
	const input = definition.input;
	const output = definition.output;

	setPhase("input");
	let parsedInput: unknown;
	try {
		parsedInput = await Schema.decodeUnknownPromise(input)(payload.context ?? {});
	} catch (error) {
		return throwPhase("input", "Definition input validation failed: " + nativeString(error));
	}

	setPhase("execute");
	const durable =
		typeof payload.workflowExecutionId === "string" && definition.manifest.kind !== "workflow"
			? await createDurableHost(definition, payload)
			: undefined;
	const host = durable?.host ?? createHost(payload);
	let result: unknown;
	try {
		const execution = run(parsedInput, host, {
			startedAt: payload.startedAt,
			metadata: payload.metadata ?? {},
			sandboxScriptId: payload.scriptId,
		});
		if (!Effect.isEffect(execution)) {
			return throwPhase("execute", "Sandbox definition must return an Effect");
		}
		const outcome = await Effect.runPromise(
			Effect.match(execution, {
				onFailure: (error) => ({ error, success: false as const }),
				onSuccess: (value) => ({ value, success: true as const }),
			}),
		);
		if (durable) {
			const detachedError = durable.detachedError();
			if (detachedError) {
				return {
					state: "failed",
					error: detachedError,
					requests: durable.startedRequests(),
					journalLength: durable.journalLength,
				};
			}
			if (durable.isPending()) {
				return {
					state: "pending",
					requests: durable.requests,
					journalLength: durable.journalLength,
				};
			}
			if (!outcome.success) {
				return {
					state: "failed",
					requests: durable.requests,
					journalLength: durable.journalLength,
					error: nativeString(outcome.error),
				};
			}
			setPhase("output");
			try {
				const decoded = await Schema.decodeUnknownPromise(output)(outcome.value);
				return {
					state: "completed",
					requests: durable.requests,
					journalLength: durable.journalLength,
					output: jsonClone(decoded, "Definition output"),
				};
			} catch (error) {
				return {
					state: "failed",
					requests: durable.requests,
					journalLength: durable.journalLength,
					error: "Definition output validation failed: " + nativeString(error),
				};
			}
		}
		if (!outcome.success) {
			return throwPhase("execute", outcome.error);
		}
		result = outcome.value;
	} catch (error) {
		return throwPhase("execute", error);
	}

	setPhase("output");
	try {
		return await Schema.decodeUnknownPromise(output)(result);
	} catch (error) {
		return throwPhase("output", "Definition output validation failed: " + nativeString(error));
	}
};

void (async () => {
	for (;;) {
		const line = await readLine();
		if (!line.trim()) {
			continue;
		}

		let phase = "input";
		let payload: SandboxRunnerPayload | undefined;
		let logCollector: SandboxLogCollector = {
			logs: [],
			console: {
				log: () => {},
				info: () => {},
				warn: () => {},
				debug: () => {},
				error: () => {},
			},
		};
		const startedAt = performanceNow();
		const previousConsole = {
			log: console.log,
			info: console.info,
			warn: console.warn,
			debug: console.debug,
			error: console.error,
		};

		try {
			payload = jsonParse(line) as SandboxRunnerPayload;
			if (!validateLimits(payload.limits)) {
				throwPhase("input", "Sandbox runner limits are invalid");
			}
			logCollector = createLogCollector(payload.limits);
			console.log = logCollector.console.log;
			console.info = logCollector.console.info;
			console.warn = logCollector.console.warn;
			console.debug = logCollector.console.debug;
			console.error = logCollector.console.error;
			installFilesystem(payload);
			disableCodeGeneration();

			phase = "load";
			const restoreWorkflowGlobals =
				typeof payload.workflowExecutionId === "string" ||
				(isRecord(payload.metadata) && payload.metadata.kind === "workflow")
					? installWorkflowDeterminismGuard()
					: undefined;
			let value: unknown;
			try {
				const compiledModule = await importCompiledModule(payload);
				value = await executeDefinition(compiledModule.default, payload, (nextPhase) => {
					phase = nextPhase;
				});
			} finally {
				restoreWorkflowGlobals?.();
			}

			phase = "output";
			let serialized: string | undefined;
			try {
				serialized = jsonStringify(value ?? null);
			} catch (error) {
				throwPhase("output", error);
			}
			const serializedValue =
				typeof serialized === "string"
					? serialized
					: throwPhase("output", "Sandbox definition result is not JSON-serializable");
			if (encodeText(serializedValue).byteLength > payload.limits.resultBytes) {
				throwPhase(
					"output",
					"Sandbox definition result exceeds " + payload.limits.resultBytes + " UTF-8 bytes",
				);
			}
			await writeSuccess(logCollector.logs, serializedValue, performanceNow() - startedAt);
		} catch (error) {
			const errorPhase = failurePhase(error, phase);
			await writeFailure(
				logCollector.logs,
				executionError(error, errorPhase, payload),
				performanceNow() - startedAt,
			);
		} finally {
			console.log = previousConsole.log;
			console.info = previousConsole.info;
			console.warn = previousConsole.warn;
			console.debug = previousConsole.debug;
			console.error = previousConsole.error;
		}
	}
})();
