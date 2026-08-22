import { Schema } from "effect";

export type JsonPrimitive = boolean | number | string | null;

export type JsonValue =
	| JsonPrimitive
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };

export const isJsonValue = (value: unknown): value is JsonValue => {
	const active = new WeakSet<object>();

	const visit = (current: unknown): current is JsonValue => {
		if (
			current === null ||
			typeof current === "boolean" ||
			typeof current === "string" ||
			(typeof current === "number" && Number.isFinite(current))
		) {
			return true;
		}
		if (typeof current !== "object" || active.has(current)) {
			return false;
		}

		active.add(current);
		try {
			if (Array.isArray(current)) {
				if (Object.getPrototypeOf(current) !== Array.prototype) {
					return false;
				}
				const keys = Reflect.ownKeys(current);
				if (keys.length !== current.length + 1 || keys.at(-1) !== "length") {
					return false;
				}
				for (let index = 0; index < current.length; index += 1) {
					const key = String(index);
					const descriptor = Object.getOwnPropertyDescriptor(current, key);
					if (
						keys[index] !== key ||
						!descriptor?.enumerable ||
						!("value" in descriptor) ||
						!visit(descriptor.value)
					) {
						return false;
					}
				}
				return true;
			}

			const prototype = Object.getPrototypeOf(current);
			if (prototype !== Object.prototype && prototype !== null) {
				return false;
			}
			for (const key of Reflect.ownKeys(current)) {
				if (typeof key !== "string") {
					return false;
				}
				const descriptor = Object.getOwnPropertyDescriptor(current, key);
				if (!descriptor?.enumerable || !("value" in descriptor) || !visit(descriptor.value)) {
					return false;
				}
			}
			return true;
		} catch {
			return false;
		} finally {
			active.delete(current);
		}
	};

	return visit(value);
};

export const JsonValue = Schema.declare<JsonValue>(isJsonValue).annotate({
	identifier: "JsonValue",
}) as Schema.Codec<JsonValue, JsonValue>;

export const jsonValueSchema = JsonValue;
