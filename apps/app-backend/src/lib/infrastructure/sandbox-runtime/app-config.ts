import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { Effect, Option, Redacted } from "effect";

import type { AnyMeta, GroupMeta } from "../config/builder";
import { appConfigMeta } from "../config/service";

const isEffectOption = (value: unknown): value is Option.Option<unknown> =>
	isObjectRecord(value) &&
	(Reflect.get(value, "_tag") === "Some" || Reflect.get(value, "_tag") === "None");

const unwrapAppConfigValue = (value: unknown): unknown => {
	if (isEffectOption(value)) {
		return Option.isNone(value) ? undefined : unwrapAppConfigValue(value.value);
	}
	return Redacted.isRedacted(value) ? Redacted.value(value) : value;
};

const resolveChildMeta = (node: GroupMeta, segment: string): AnyMeta | undefined =>
	Object.hasOwn(node.children, segment) ? node.children[segment] : undefined;

const resolveAppConfigFieldMeta = (key: string) => {
	const segments = key.split(".").map((segment) => segment.trim());
	if (segments.some((segment) => segment.length === 0)) {
		return null;
	}

	let node: AnyMeta = appConfigMeta;
	for (const segment of segments) {
		if (node.kind === "field") {
			return null;
		}
		const child = resolveChildMeta(node, segment);
		if (!child) {
			return null;
		}
		node = child;
	}

	return node.kind === "field" ? node : null;
};

const resolveAppConfigEntry = (config: unknown, key: string) => {
	const meta = resolveAppConfigFieldMeta(key);
	if (!meta) {
		return null;
	}

	let value = config;
	for (const segment of key.split(".")) {
		if (!isObjectRecord(value) || !Object.hasOwn(value, segment)) {
			return null;
		}
		value = value[segment];
	}
	return { meta, value };
};

const resolveAppConfigValue = Effect.fn("resolveAppConfigValue")(function* (
	config: unknown,
	key: string,
) {
	const entry = resolveAppConfigEntry(config, key);
	if (!entry) {
		return yield* Effect.fail(`Config key "${key}" does not exist`);
	}

	return entry;
});

export const isAppConfigKeyConfigured = (config: unknown, key: string): boolean => {
	const entry = resolveAppConfigEntry(config, key);
	return entry !== null && unwrapAppConfigValue(entry.value) !== undefined;
};

export const getSandboxAppConfigValue = (
	config: unknown,
	key: string,
	access: { scriptIsBuiltin: boolean; requiredAppConfigKeys: ReadonlyArray<string> },
): Effect.Effect<unknown, string> =>
	resolveAppConfigValue(config, key).pipe(
		Effect.flatMap(({ meta, value }) => {
			if (meta.builtinOnly && !access.scriptIsBuiltin) {
				return Effect.fail(`Config key "${key}" is only available to builtin scripts`);
			}

			if (
				meta.sensitive &&
				!access.scriptIsBuiltin &&
				!access.requiredAppConfigKeys.includes(key)
			) {
				return Effect.fail(`Config key "${key}" is sensitive`);
			}

			const unwrapped = unwrapAppConfigValue(value);
			return unwrapped === undefined
				? Effect.fail(`Config key "${key}" is not configured`)
				: Effect.succeed(unwrapped);
		}),
	);
