const nativeError = globalThis.Error;
const reflectApply = Reflect.apply;
const arrayIsArray = Array.isArray;
const arrayBufferIsView = ArrayBuffer.isView.bind(ArrayBuffer);
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const uint8ArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
let sealed = false;

export const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
export const isNumber = (value: unknown): value is number => typeof value === "number";
export const isString = (value: unknown): value is string => typeof value === "string";
export const isObject = (value: unknown): value is object =>
	typeof value === "object" && value !== null;
export const isArray = (value: unknown): value is unknown[] => arrayIsArray(value);
export const isStringArray = (value: unknown): value is string[] => arrayIsArray(value);
const isExecResult = (value: unknown): value is RegExpExecArray | null =>
	value === null || arrayIsArray(value);
const isUint8Array = (value: unknown): value is Uint8Array => arrayBufferIsView(value);

/**
 * Captures a prototype method while module evaluation still precedes script code. The returned
 * function takes the receiver as its first argument and rejects results of an unexpected type.
 */
export const uncurry = <Self, Result>(
	prototype: Self,
	name: string,
	isResult: (value: unknown) => value is Result,
) => {
	if (sealed) {
		throw new nativeError("Sandbox runner primordials are sealed: " + name);
	}
	const method: unknown = getOwnPropertyDescriptor(prototype, name)?.value;
	if (typeof method !== "function") {
		throw new nativeError("Sandbox runner primordial is missing: " + name);
	}
	return (self: Self, ...args: readonly unknown[]): Result => {
		const result: unknown = reflectApply(method, self, args);
		if (!isResult(result)) {
			throw new nativeError("Sandbox runner primordial returned an unexpected result: " + name);
		}
		return result;
	};
};

export const sealPrimordials = () => {
	sealed = true;
};

export const regExpExec = uncurry(RegExp.prototype, "exec", isExecResult);
export const stringIncludes = uncurry(String.prototype, "includes", isBoolean);
export const uint8ArraySubarray = uncurry(uint8ArrayPrototype, "subarray", isUint8Array);
