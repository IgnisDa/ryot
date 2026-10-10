import { configureApprovedDependencyRuntime } from "@ryot-app/sandbox-sdk/dependency-runtime";

import { isRecord } from "./isolate-utilities";
import type { SandboxInvocation } from "./sidecar-protocol";

const nativeDate = globalThis.Date;
const nativeMath = globalThis.Math;
const nativeCrypto = globalThis.crypto;
const nativePerformance = globalThis.performance;
const nativeError = globalThis.Error;
const nativeString = globalThis.String;
const nativeUint8Array = globalThis.Uint8Array;
const nativeDateParse = nativeDate.parse.bind(nativeDate);
const nativeDateUtc = nativeDate.UTC.bind(nativeDate);
const mathFloor = Math.floor;
const mathImul = Math.imul;
const stringPadStartMethod = Object.getOwnPropertyDescriptor(String.prototype, "padStart")?.value;
const stringPadStart = stringPadStartMethod.call.bind(stringPadStartMethod);
const dateToStringMethod = Object.getOwnPropertyDescriptor(nativeDate.prototype, "toString")?.value;
const dateToString = dateToStringMethod.call.bind(dateToStringMethod);
const numberToStringMethod = Object.getOwnPropertyDescriptor(Number.prototype, "toString")?.value;
const numberToString = numberToStringMethod.call.bind(numberToStringMethod);
const nativeFunction = globalThis.Function;
const nativeProxy = globalThis.Proxy;
const reflectConstruct = Reflect.construct;
const reflectGet = Reflect.get;
const objectDefineProperty = Object.defineProperty;
const objectSetPrototypeOf = Object.setPrototypeOf;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const reflectDeleteProperty = Reflect.deleteProperty;
const generatorFunction = Object.getPrototypeOf(function* () {}).constructor;

const blockedWorkflowNondeterminism = (name: string) => () => {
	throw new nativeError("Workflow code cannot use ambient nondeterminism: " + name);
};

const makeGlobalReplacements = () => {
	const restores: Array<() => void> = [];
	return {
		restore: () => {
			for (let index = restores.length - 1; index >= 0; index -= 1) {
				restores[index]?.();
			}
			restores.length = 0;
		},
		replace: (target: object, name: PropertyKey, value: unknown) => {
			const descriptor = objectGetOwnPropertyDescriptor(target, name);
			objectDefineProperty(target, name, {
				value,
				configurable: true,
				enumerable: descriptor?.enumerable ?? false,
			});
			restores[restores.length] = () => {
				if (descriptor) {
					objectDefineProperty(target, name, descriptor);
				} else {
					reflectDeleteProperty(target, name);
				}
			};
		},
	};
};

const makeDateProxy = (
	call: () => string,
	construct: NonNullable<ProxyHandler<() => string>["construct"]>,
	now: () => number,
) => {
	const date = new nativeProxy(
		function () {
			return call();
		},
		{ construct },
	);
	objectSetPrototypeOf(date.prototype, nativeDate.prototype);
	objectDefineProperty(date.prototype, "constructor", { value: date });
	objectDefineProperty(date, "now", { value: now });
	objectDefineProperty(date, "UTC", { value: nativeDateUtc });
	objectDefineProperty(date, "parse", { value: nativeDateParse });
	return date;
};

type ApprovedDependencyRuntime = {
	readonly configure: (invocation: SandboxInvocation) => void;
	readonly withGlobals: <A>(operation: () => Promise<A>) => Promise<A>;
};

const makeApprovedDependencyRuntime = (): ApprovedDependencyRuntime => {
	let startedAt = "1970-01-01T00:00:00.000Z";
	let randomState = 2_166_136_261;
	let active = 0;
	let enabled = false;
	let globals: ReturnType<typeof makeGlobalReplacements> | undefined;

	const configure = (invocation: SandboxInvocation) => {
		enabled =
			invocation.workflowExecutionId !== undefined || invocation.metadata.kind === "workflow";
		startedAt = invocation.startedAt;
		randomState = 2_166_136_261;
		const seed = invocation.workflowExecutionId ?? invocation.executionId;
		for (let index = 0; index < seed.length; index += 1) {
			randomState = mathImul(randomState ^ seed.charCodeAt(index), 16_777_619) >>> 0;
		}
	};

	const nextRandom = () => {
		randomState = mathImul(randomState ^ (randomState >>> 13), 1_664_525) + 1_013_904_223;
		return (randomState >>> 0) / 4_294_967_296;
	};

	const deterministicDate = makeDateProxy(
		() => nativeString(dateToString(new nativeDate(startedAt))),
		(_target, args, newTarget) =>
			reflectConstruct(nativeDate, args.length === 0 ? [startedAt] : args, newTarget),
		() => nativeDateParse(startedAt),
	);

	// oxlint-disable-next-line effecttsgo/async-function -- The SDK approved-dependency callback is Promise-native.
	const withGlobals = async <A>(operation: () => Promise<A>) => {
		if (!enabled) {
			return await operation();
		}
		if (active === 0) {
			globals = makeGlobalReplacements();
			globals.replace(globalThis, "Date", deterministicDate);
			globals.replace(nativeMath, "random", nextRandom);
			globals.replace(nativeCrypto, "randomUUID", () => {
				const bytes = new nativeUint8Array(16);
				for (let index = 0; index < bytes.length; index += 1) {
					bytes[index] = mathFloor(nextRandom() * 256);
				}
				bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
				bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
				let uuid = "";
				for (let index = 0; index < bytes.length; index += 1) {
					if (index === 4 || index === 6 || index === 8 || index === 10) {
						uuid += "-";
					}
					uuid += nativeString(
						stringPadStart(nativeString(numberToString(bytes[index] ?? 0, 16)), 2, "0"),
					);
				}
				return uuid;
			});
			globals.replace(nativeCrypto, "getRandomValues", (value: ArrayBufferView) => {
				const bytes = new nativeUint8Array(value.buffer, value.byteOffset, value.byteLength);
				for (let index = 0; index < bytes.length; index += 1) {
					bytes[index] = mathFloor(nextRandom() * 256);
				}
				return value;
			});
		}
		active += 1;
		try {
			return await operation();
		} finally {
			active -= 1;
			if (active === 0) {
				globals?.restore();
				globals = undefined;
			}
		}
	};

	return { configure, withGlobals };
};

export const approvedDependencyRuntime = makeApprovedDependencyRuntime();
const asyncFunction = Object.getPrototypeOf(approvedDependencyRuntime.withGlobals).constructor;
configureApprovedDependencyRuntime(approvedDependencyRuntime.withGlobals);

export const disableCodeGeneration = () => {
	for (const name of ["eval", "Function", "Worker", "SharedWorker"]) {
		if (name in globalThis) {
			objectDefineProperty(globalThis, name, {
				writable: false,
				value: undefined,
				enumerable: false,
				configurable: false,
			});
		}
	}
	for (const constructor of [nativeFunction, asyncFunction, generatorFunction]) {
		objectDefineProperty(constructor.prototype, "constructor", {
			writable: false,
			value: undefined,
			enumerable: false,
			configurable: false,
		});
	}
	// The isolate-level string-codegen policy also blocks the async-generator constructor.
};

export const installWorkflowDeterminismGuard = () => {
	const globals = makeGlobalReplacements();
	const workflowDate = makeDateProxy(
		() => {
			throw new nativeError("Workflow code cannot call ambient Date()");
		},
		(_target, args, newTarget) => {
			if (args.length === 0) {
				throw new nativeError(
					"Workflow code cannot construct an ambient current date with new Date()",
				);
			}
			return reflectConstruct(nativeDate, args, newTarget);
		},
		() => 0,
	);

	try {
		globals.replace(globalThis, "Date", workflowDate);
		globals.replace(nativeMath, "random", blockedWorkflowNondeterminism("Math.random"));
		globals.replace(nativeCrypto, "randomUUID", blockedWorkflowNondeterminism("crypto.randomUUID"));
		globals.replace(
			nativeCrypto,
			"getRandomValues",
			blockedWorkflowNondeterminism("crypto.getRandomValues"),
		);
		globals.replace(nativePerformance, "now", blockedWorkflowNondeterminism("performance.now"));

		const temporal = reflectGet(globalThis, "Temporal");
		if (isRecord(temporal)) {
			const temporalNow = reflectGet(temporal, "Now");
			if (isRecord(temporalNow)) {
				const blockedTemporalNow = blockedWorkflowNondeterminism("Temporal.Now");
				const workflowTemporalNow = new nativeProxy(temporalNow, {
					get: (target, name, receiver) => {
						const value = reflectGet(target, name, receiver);
						return typeof value === "function" ? blockedTemporalNow : value;
					},
				});
				globals.replace(temporal, "Now", workflowTemporalNow);
			}
		}
	} catch (error) {
		globals.restore();
		throw error instanceof nativeError ? error : new nativeError(nativeString(error));
	}

	return globals.restore;
};
