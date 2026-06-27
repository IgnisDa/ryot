import {
	createLogCollector,
	executionError,
	failurePhase,
	isRecord,
	readBridgeResponse,
	throwPhase,
	validateLimits,
} from "./runner-utilities.sandbox.js";

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const arrayIsArray = Array.isArray;
const nativeError = globalThis.Error;
const exitDeno = Deno.exit.bind(Deno);
const createDictionary = Object.create;
const nativeString = globalThis.String;
const nativeFunction = globalThis.Function;
const defineProperty = Object.defineProperty;
const jsonParse = JSON.parse.bind(JSON);
const readStdin = Deno.stdin.read.bind(Deno.stdin);
const encodeComponent = globalThis.encodeURIComponent;
const writeStdout = Deno.stdout.write.bind(Deno.stdout);
const encodeText = encoder.encode.bind(encoder);
const decodeText = decoder.decode.bind(decoder);
const jsonStringify = JSON.stringify.bind(JSON);
const bridgeFetch = globalThis.fetch.bind(globalThis);
const performanceNow = performance.now.bind(performance);
const generatorFunction = Object.getPrototypeOf(function* () {}).constructor;
const asyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const asyncGeneratorFunction = Object.getPrototypeOf(async function* () {}).constructor;

let buffer = "";

const disableFormat1CodeGeneration = () => {
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

async function readLine() {
	const chunk = new Uint8Array(65536);
	for (;;) {
		const count = await readStdin(chunk);
		if (count === null) {
			exitDeno(0);
		}
		buffer += decodeText(chunk.subarray(0, count));
		const newlineIdx = buffer.indexOf("\n");
		if (newlineIdx !== -1) {
			const line = buffer.slice(0, newlineIdx);
			buffer = buffer.slice(newlineIdx + 1);
			return line;
		}
	}
}

const hostFailure = (error) => ({ error, success: false });

const createApiStub =
	(fnName, payload, budget) =>
	async (...args) => {
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

		let requestBody;
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

		let body;
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

const createHost = (payload, declaredCapabilities) => {
	const approved = arrayIsArray(payload.apiFunctions) ? payload.apiFunctions : [];
	const declared = arrayIsArray(declaredCapabilities) ? declaredCapabilities : [];
	const budget = { http: 0, total: 0 };
	const host = createDictionary(null);
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

const serializeLogs = (logs) => {
	let serialized = "[";
	for (let index = 0; index < logs.length; index += 1) {
		serialized += `${index === 0 ? "" : ","}${jsonStringify(logs[index])}`;
	}
	return serialized + "]";
};

const writeSuccess = async (logs, serializedValue, executionMs) => {
	const result = `{"success":true,"logs":${serializeLogs(logs)},"value":${serializedValue},"timing":{"executionMs":${executionMs}}}\n`;
	await writeStdout(encodeText(result));
};

const writeFailure = async (logs, error, executionMs) => {
	const serializedError = `{"phase":${jsonStringify(error.phase)},"message":${jsonStringify(error.message)}${error.line === undefined ? "" : `,"line":${error.line}`}${error.column === undefined ? "" : `,"column":${error.column}`}${error.stack === undefined ? "" : `,"stack":${jsonStringify(error.stack)}`}}`;
	const result = `{"success":false,"logs":${serializeLogs(logs)},"error":${serializedError},"timing":{"executionMs":${executionMs}}}\n`;
	await writeStdout(encodeText(result));
};

const stringArraysMatch = (left, right) => {
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

const manifestsMatch = (left, right) =>
	isRecord(left) &&
	isRecord(right) &&
	left.kind === right.kind &&
	left.name === right.name &&
	left.slug === right.slug &&
	stringArraysMatch(left.capabilities, right.capabilities) &&
	stringArraysMatch(left.requiredAppConfigKeys, right.requiredAppConfigKeys);

const importCompiledModule = async (payload) => {
	if (payload.compiledFormat !== 0 && payload.compiledFormat !== 1) {
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
			"data:text/javascript;charset=utf-8," + encodeURIComponent(payload.compiledCode)
		);
	} catch (error) {
		return throwPhase("load", error);
	}
};

const executeDefinition = async (definition, payload, host, setPhase) => {
	if (!isRecord(definition)) {
		throwPhase("load", "Compiled sandbox module must have a default definition export");
	}

	if (payload.compiledFormat === 0) {
		if (
			definition.definitionType !== "ryot:legacy-sandbox-script" ||
			typeof definition.execute !== "function"
		) {
			throwPhase("load", "Legacy compiled sandbox module has an invalid definition");
		}
		setPhase("execute");
		try {
			return await definition.execute(payload.driverName, payload.context ?? {}, host, {
				metadata: payload.metadata ?? {},
				sandboxScriptId: payload.scriptId,
			});
		} catch (error) {
			throwPhase("execute", error);
		}
	}

	if (
		definition.definitionType !== "ryot:sandbox-script" ||
		!isRecord(definition.manifest) ||
		!isRecord(definition.drivers)
	) {
		throwPhase("load", "Compiled sandbox module has an invalid script definition");
	}
	if (!manifestsMatch(definition.manifest, payload.metadata)) {
		throwPhase("load", "Compiled sandbox manifest does not match persisted metadata");
	}
	const driver = definition.drivers[payload.driverName];
	if (!isRecord(driver) || typeof driver.run !== "function") {
		throwPhase("load", 'Driver "' + payload.driverName + '" is not defined in this script');
	}
	if (
		!isRecord(driver.input) ||
		typeof driver.input.safeParseAsync !== "function" ||
		!isRecord(driver.output) ||
		typeof driver.output.safeParseAsync !== "function"
	) {
		throwPhase("load", 'Driver "' + payload.driverName + '" has invalid schemas');
	}

	setPhase("input");
	let input;
	try {
		input = await driver.input.safeParseAsync(payload.context ?? {});
	} catch (error) {
		throwPhase("input", error);
	}
	if (!input.success) {
		throwPhase("input", "Driver input validation failed: " + input.error.message);
	}

	setPhase("execute");
	let result;
	try {
		result = await driver.run(input.data, host, {
			metadata: payload.metadata ?? {},
			sandboxScriptId: payload.scriptId,
		});
	} catch (error) {
		throwPhase("execute", error);
	}

	setPhase("output");
	let output;
	try {
		output = await driver.output.safeParseAsync(result);
	} catch (error) {
		throwPhase("output", error);
	}
	if (!output.success) {
		throwPhase("output", "Driver output validation failed: " + output.error.message);
	}
	return output.data;
};

void (async () => {
	for (;;) {
		const line = await readLine();
		if (!line.trim()) {
			continue;
		}

		let phase = "input";
		let payload;
		let logCollector = { logs: [], console: null };
		const startedAt = performanceNow();
		const previousConsole = {
			log: console.log,
			info: console.info,
			warn: console.warn,
			debug: console.debug,
			error: console.error,
		};

		try {
			payload = jsonParse(line);
			if (!validateLimits(payload.limits)) {
				throwPhase("input", "Sandbox runner limits are invalid");
			}
			logCollector = createLogCollector(payload.limits);
			console.log = logCollector.console.log;
			console.info = logCollector.console.info;
			console.warn = logCollector.console.warn;
			console.debug = logCollector.console.debug;
			console.error = logCollector.console.error;
			if (!payload.driverName) {
				throwPhase("input", "driverName is required");
			}
			if (payload.compiledFormat === 1) {
				disableFormat1CodeGeneration();
			}

			phase = "load";
			const declaredCapabilities =
				payload.compiledFormat === 1 && isRecord(payload.metadata)
					? payload.metadata.capabilities
					: payload.apiFunctions;
			const host = createHost(payload, declaredCapabilities);
			const module = await importCompiledModule(payload);
			const value = await executeDefinition(module.default, payload, host, (nextPhase) => {
				phase = nextPhase;
			});

			phase = "output";
			let serializedValue;
			try {
				serializedValue = jsonStringify(value ?? null);
			} catch (error) {
				throwPhase("output", error);
			}
			if (typeof serializedValue !== "string") {
				throwPhase("output", "Sandbox driver result is not JSON-serializable");
			}
			if (encodeText(serializedValue).byteLength > payload.limits.resultBytes) {
				throwPhase(
					"output",
					"Sandbox driver result exceeds " + payload.limits.resultBytes + " UTF-8 bytes",
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

export default "";
