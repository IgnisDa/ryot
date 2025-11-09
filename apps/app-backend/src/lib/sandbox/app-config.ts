import { Effect, Option, Redacted } from "effect";

import { isObjectRecord } from "#lib/predicates";

import type { AnyMeta, GroupMeta } from "../config/builder";
import { appConfigMeta } from "../config/service";

const isEffectOption = (value: unknown): value is Option.Option<unknown> =>
	isObjectRecord(value) &&
	(Reflect.get(value, "_tag") === "Some" || Reflect.get(value, "_tag") === "None");

const unwrapAppConfigValue = (value: unknown) => {
	if (isEffectOption(value)) {
		if (Option.isNone(value)) {
			return Effect.void;
		}

		return unwrapAppConfigValue(value.value);
	}

	return Effect.succeed(Redacted.isRedacted(value) ? Redacted.value(value) : value);
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

const resolveAppConfigValue = Effect.fn("resolveAppConfigValue")(function* (
	config: unknown,
	key: string,
) {
	const meta = resolveAppConfigFieldMeta(key);
	if (!meta) {
		return yield* Effect.fail(`Config key "${key}" does not exist`);
	}

	let value = config;
	for (const segment of key.split(".")) {
		if (!isObjectRecord(value) || !Object.hasOwn(value, segment)) {
			return yield* Effect.fail(`Config key "${key}" does not exist`);
		}
		value = value[segment];
	}

	return { meta, value };
});

export const getSandboxAppConfigValue = (
	config: unknown,
	key: string,
	scriptIsBuiltin: boolean,
): Effect.Effect<unknown, string> =>
	resolveAppConfigValue(config, key).pipe(
		Effect.flatMap(({ meta, value }) => {
			if (meta.sensitive && !scriptIsBuiltin) {
				return Effect.fail(`Config key "${key}" is sensitive`);
			}

			return unwrapAppConfigValue(value).pipe(
				Effect.flatMap((unwrapped) =>
					unwrapped === undefined
						? Effect.fail(`Config key "${key}" is not configured`)
						: Effect.succeed(unwrapped),
				),
			);
		}),
	);
