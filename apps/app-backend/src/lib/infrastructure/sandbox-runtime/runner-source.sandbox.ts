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

const reflectGet = Reflect.get;
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const nativeDate = globalThis.Date;
const arrayIsArray = Array.isArray;
const nativeError = globalThis.Error;
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

const strictStruct = <Fields extends Record<string, Schema.Struct.Field>>(fields: Fields) =>
	Schema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "error" as const } });
const hostResultSchema = Schema.Union(
	strictStruct({
		error: Schema.String,
		success: Schema.Literal(false),
		data: Schema.optional(Schema.Unknown),
	}),
	strictStruct({
		data: Schema.Unknown.pipe(
			Schema.filter((value) => value !== undefined, {
				message: () => "Host result data is required",
			}),
		),
		success: Schema.Literal(true),
	}),
);
const decodeHostResult = Schema.decodeUnknown(hostResultSchema);

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
	return isRecord(error) && error.data !== undefined
		? { message, data: error.data as SandboxHostError["data"] }
		: { message };
};

const transportHostCall =
	(fnName: string, payload: SandboxRunnerPayload, budget: HostBudget) =>
	async (args: readonly unknown[]): Promise<unknown> => {
		budget.total += 1;
		if (fnName === "httpCall") {
			budget.http += 1;
		}
		if (budget.total > payload.limits.hostCallCount) {
			return hostFailure(
				"Sandbox execution exceeds " + payload.limits.hostCallCount + " host calls",
			);
		}
		if (budget.http > payload.limits.httpCallCount) {
			return hostFailure(
				"Sandbox execution exceeds " + payload.limits.httpCallCount + " httpCall calls",
			);
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
		const responseBody = await readBridgeResponse(response, payload.limits.bridgeResponseBytes);
		if (responseBody.oversized) {
			return hostFailure(
				"Sandbox bridge response exceeds " + payload.limits.bridgeResponseBytes + " UTF-8 bytes",
			);
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

const createHost = (payload: SandboxRunnerPayload, declaredCapabilities: unknown) => {
	const approved = arrayIsArray(payload.apiFunctions) ? payload.apiFunctions : [];
	const declared = arrayIsArray(declaredCapabilities) ? declaredCapabilities : [];
	const budget: HostBudget = { http: 0, total: 0 };
	const host: Record<string, unknown> = createDictionary(null);
	for (let declaredIndex = 0; declaredIndex < declared.length; declaredIndex += 1) {
		const fnName = declared[declaredIndex];
		if (typeof fnName !== "string") {
			continue;
		}
		for (let approvedIndex = 0; approvedIndex < approved.length; approvedIndex += 1) {
			if (approved[approvedIndex] === fnName) {
				host[fnName] = createApiStub(fnName, payload, budget);
				break;
			}
		}
	}
	return host;
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
	if (typeof payload.compiledCode !== "string" || !payload.compiledCode.trim()) {
		throwPhase("load", "Compiled sandbox module is empty");
	}

	try {
		return await import(
			"data:text/javascript;charset=utf-8," + encodeComponent(payload.compiledCode)
		);
	} catch (error) {
		return throwPhase("load", error);
	}
};

const executeDefinition = async (
	definition: unknown,
	payload: SandboxRunnerPayload,
	host: Record<string, unknown>,
	setPhase: (phase: string) => void,
): Promise<unknown> => {
	if (!isRecord(definition)) {
		return throwPhase("load", "Compiled sandbox module must have a default definition export");
	}

	if (definition.definitionType !== "ryot:sandbox-script" || !isRecord(definition.manifest)) {
		return throwPhase("load", "Compiled sandbox module has an invalid script definition");
	}
	if (!manifestsMatch(definition.manifest, payload.metadata)) {
		return throwPhase("load", "Compiled sandbox manifest does not match persisted metadata");
	}
	if (typeof definition.run !== "function") {
		return throwPhase("load", "Compiled sandbox definition has an invalid run function");
	}
	if (!Schema.isSchema(definition.input) || !Schema.isSchema(definition.output)) {
		return throwPhase("load", "Compiled sandbox definition has invalid schemas");
	}
	const run = definition.run;
	const input = definition.input as Schema.Schema.AnyNoContext;
	const output = definition.output as Schema.Schema.AnyNoContext;

	setPhase("input");
	let parsedInput: unknown;
	try {
		parsedInput = await Effect.runPromise(Schema.decodeUnknown(input)(payload.context ?? {}));
	} catch (error) {
		return throwPhase("input", "Definition input validation failed: " + nativeString(error));
	}

	setPhase("execute");
	let result: unknown;
	try {
		const execution = run(parsedInput, host, {
			metadata: payload.metadata ?? {},
			sandboxScriptId: payload.scriptId,
		});
		if (!Effect.isEffect(execution)) {
			return throwPhase("execute", "Sandbox definition must return an Effect");
		}
		const outcome = await Effect.runPromise(
			Effect.match(execution as Effect.Effect<unknown, unknown>, {
				onFailure: (error) => ({ error, success: false as const }),
				onSuccess: (value) => ({ value, success: true as const }),
			}),
		);
		if (!outcome.success) {
			return throwPhase("execute", outcome.error);
		}
		result = outcome.value;
	} catch (error) {
		return throwPhase("execute", error);
	}

	setPhase("output");
	try {
		return await Effect.runPromise(Schema.decodeUnknown(output)(result));
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
			const declaredCapabilities =
				isRecord(payload.metadata) && payload.metadata.kind !== "workflow"
					? payload.metadata.capabilities
					: payload.apiFunctions;
			const host = createHost(payload, declaredCapabilities);
			const restoreWorkflowGlobals =
				isRecord(payload.metadata) && payload.metadata.kind === "workflow"
					? installWorkflowDeterminismGuard()
					: undefined;
			let value: unknown;
			try {
				const compiledModule = await importCompiledModule(payload);
				value = await executeDefinition(compiledModule.default, payload, host, (nextPhase) => {
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
			if (typeof serialized !== "string") {
				throwPhase("output", "Sandbox definition result is not JSON-serializable");
			}
			const serializedValue = serialized as string;
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
