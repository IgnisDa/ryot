import type { JsonValue } from "@ryot/sandbox-sdk";
import type { Option, Redacted } from "effect";

import type { FieldMeta, GroupMeta } from "../config/builder";
import type { appConfigMeta, AppConfigValue } from "../config/service";

type UnionToIntersection<Value> = (Value extends unknown ? (value: Value) => void : never) extends (
	value: infer Intersection,
) => void
	? Intersection
	: never;

type SandboxConfigValue<Value> =
	Value extends Option.Option<infer Inner>
		? SandboxConfigValue<Inner>
		: Value extends Redacted.Redacted
			? string
			: Value extends JsonValue
				? Value
				: never;

type SandboxConfigField<Key extends string, Value> = [SandboxConfigValue<Value>] extends [never]
	? never
	: Record<Key, SandboxConfigValue<Value>>;

type SandboxConfigMap<
	Meta extends GroupMeta,
	Value,
	Prefix extends string = "",
> = UnionToIntersection<
	{
		[Key in keyof Meta["children"] & keyof Value & string]: Meta["children"][Key] extends FieldMeta
			? SandboxConfigField<`${Prefix}${Key}`, Value[Key]>
			: Meta["children"][Key] extends GroupMeta
				? SandboxConfigMap<Meta["children"][Key], Value[Key], `${Prefix}${Key}.`>
				: never;
	}[keyof Meta["children"] & keyof Value & string]
>;

export type SandboxAppConfig = SandboxConfigMap<typeof appConfigMeta, AppConfigValue>;

declare module "@ryot/sandbox-sdk" {
	interface SandboxAppConfigRegistry {
		appBackend: SandboxAppConfig;
	}
}
