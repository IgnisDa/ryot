const decoder = new TextDecoder();
const encoder = new TextEncoder();
const arrayIsArray = Array.isArray;
const bridgeFetch = globalThis.fetch.bind(globalThis);
const createDictionary = Object.create;
const encodeComponent = globalThis.encodeURIComponent;
const defineProperty = Object.defineProperty;
const reflectApply = Reflect.apply;
const responseJson = Object.getOwnPropertyDescriptor(Response.prototype, "json").value;
const nativeFunction = globalThis.Function;
const asyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const generatorFunction = Object.getPrototypeOf(function* () {}).constructor;
const asyncGeneratorFunction = Object.getPrototypeOf(async function* () {}).constructor;
let buffer = "";

const disableFormat1CodeGeneration = () => {
	for (const name of ["eval", "Function", "Worker", "SharedWorker"]) {
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

const formatArg = (value) => {
	if (typeof value === "string") {
		return value;
	}
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
};

async function readLine() {
	const chunk = new Uint8Array(65536);
	for (;;) {
		const count = await Deno.stdin.read(chunk);
		if (count === null) {
			Deno.exit(0);
		}
		buffer += decoder.decode(chunk.subarray(0, count));
		const newlineIdx = buffer.indexOf("\n");
		if (newlineIdx !== -1) {
			const line = buffer.slice(0, newlineIdx);
			buffer = buffer.slice(newlineIdx + 1);
			return line;
		}
	}
}

const createApiStub =
	(fnName, apiBase, executionId, token) =>
	async (...args) => {
		const response = await bridgeFetch(
			apiBase + "/rpc/" + encodeComponent(executionId) + "/" + encodeComponent(fnName),
			{
				method: "POST",
				body: JSON.stringify({ args }),
				headers: {
					Authorization: "Bearer " + token,
					"Content-Type": "application/json",
				},
			},
		);
		const body = await reflectApply(responseJson, response, []);
		if (!response.ok) {
			throw new Error(body.error ?? "API call failed");
		}
		return body.result;
	};

const createHost = (payload, declaredCapabilities) => {
	const approved = arrayIsArray(payload.apiFunctions) ? payload.apiFunctions : [];
	const declared = arrayIsArray(declaredCapabilities) ? declaredCapabilities : [];
	const host = createDictionary(null);
	for (let declaredIndex = 0; declaredIndex < declared.length; declaredIndex += 1) {
		const fnName = declared[declaredIndex];
		if (typeof fnName !== "string") {
			continue;
		}
		for (let approvedIndex = 0; approvedIndex < approved.length; approvedIndex += 1) {
			if (approved[approvedIndex] === fnName) {
				host[fnName] = createApiStub(fnName, payload.apiBase, payload.executionId, payload.token);
				break;
			}
		}
	}
	return host;
};

const writeResult = async (payload) => {
	await Deno.stdout.write(encoder.encode(JSON.stringify(payload) + "\n"));
};

const createRequestConsole = (logs) => ({
	log: (...args) => logs.push(args.map(formatArg).join(" ")),
	info: (...args) => logs.push(args.map(formatArg).join(" ")),
	warn: (...args) => logs.push("[warn] " + args.map(formatArg).join(" ")),
	debug: (...args) => logs.push(args.map(formatArg).join(" ")),
	error: (...args) => logs.push("[error] " + args.map(formatArg).join(" ")),
});

const isRecord = (value) => value !== null && typeof value === "object" && !arrayIsArray(value);

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
		throw new Error("Unsupported sandbox compiled format: " + String(payload.compiledFormat));
	}
	if (typeof payload.compiledCode !== "string" || !payload.compiledCode.trim()) {
		throw new Error("Compiled sandbox module is empty");
	}

	return await import(
		"data:text/javascript;charset=utf-8," + encodeURIComponent(payload.compiledCode)
	);
};

const executeDefinition = async (definition, payload, host) => {
	if (!isRecord(definition)) {
		throw new Error("Compiled sandbox module must have a default definition export");
	}

	if (payload.compiledFormat === 0) {
		if (
			definition.definitionType !== "ryot:legacy-sandbox-script" ||
			typeof definition.execute !== "function"
		) {
			throw new Error("Legacy compiled sandbox module has an invalid definition");
		}
		return await definition.execute(payload.driverName, payload.context ?? {}, host, {
			metadata: payload.metadata ?? {},
			sandboxScriptId: payload.scriptId,
		});
	}

	if (
		definition.definitionType !== "ryot:sandbox-script" ||
		!isRecord(definition.manifest) ||
		!isRecord(definition.drivers)
	) {
		throw new Error("Compiled sandbox module has an invalid script definition");
	}
	if (!manifestsMatch(definition.manifest, payload.metadata)) {
		throw new Error("Compiled sandbox manifest does not match persisted metadata");
	}
	const driver = definition.drivers[payload.driverName];
	if (!isRecord(driver) || typeof driver.run !== "function") {
		throw new Error('Driver "' + payload.driverName + '" is not defined in this script');
	}
	if (
		!isRecord(driver.input) ||
		typeof driver.input.safeParseAsync !== "function" ||
		!isRecord(driver.output) ||
		typeof driver.output.safeParseAsync !== "function"
	) {
		throw new Error('Driver "' + payload.driverName + '" has invalid schemas');
	}

	const input = await driver.input.safeParseAsync(payload.context ?? {});
	if (!input.success) {
		throw new Error("Driver input validation failed: " + input.error.message);
	}
	const result = await driver.run(input.data, host, {
		metadata: payload.metadata ?? {},
		sandboxScriptId: payload.scriptId,
	});
	const output = await driver.output.safeParseAsync(result);
	if (!output.success) {
		throw new Error("Driver output validation failed: " + output.error.message);
	}

	return output.data;
};

void (async () => {
	for (;;) {
		const line = await readLine();
		if (!line.trim()) {
			continue;
		}

		const logs = [];
		const startedAt = performance.now();
		const previousConsole = {
			log: console.log,
			info: console.info,
			warn: console.warn,
			debug: console.debug,
			error: console.error,
		};

		try {
			const payload = JSON.parse(line);
			if (payload.compiledFormat === 1) {
				disableFormat1CodeGeneration();
			}
			const requestConsole = createRequestConsole(logs);
			console.log = requestConsole.log;
			console.info = requestConsole.info;
			console.warn = requestConsole.warn;
			console.debug = requestConsole.debug;
			console.error = requestConsole.error;

			if (!payload.driverName) {
				await writeResult({
					success: false,
					error: "driverName is required",
					logs,
					timing: { executionMs: performance.now() - startedAt },
				});
				continue;
			}

			const declaredCapabilities =
				payload.compiledFormat === 1 && isRecord(payload.metadata)
					? payload.metadata.capabilities
					: payload.apiFunctions;
			const host = createHost(payload, declaredCapabilities);
			const module = await importCompiledModule(payload);
			const value = await executeDefinition(module.default, payload, host);
			await writeResult({
				success: true,
				logs,
				value: value ?? null,
				timing: { executionMs: performance.now() - startedAt },
			});
		} catch (error) {
			await writeResult({
				success: false,
				logs,
				error: error instanceof Error ? error.message : String(error),
				timing: { executionMs: performance.now() - startedAt },
			});
		} finally {
			console.log = previousConsole.log;
			console.info = previousConsole.info;
			console.warn = previousConsole.warn;
			console.debug = previousConsole.debug;
			console.error = previousConsole.error;
		}
	}
})();
