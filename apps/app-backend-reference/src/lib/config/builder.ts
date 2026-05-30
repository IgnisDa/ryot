import { Config } from "effect";

import type { FieldDef, GroupDef } from "./types";

type FieldMeta = Omit<FieldDef, "kind">;

export type FieldBuilder<A> = {
	readonly def: FieldDef;
	readonly config: Config.Config<A>;
};

export type GroupBuilder<T> = {
	readonly def: GroupDef;
	readonly config: Config.Config<T>;
};

type AnyBuilder = FieldBuilder<unknown> | GroupBuilder<unknown>;

type ExtractValue<T extends AnyBuilder> =
	T extends FieldBuilder<infer A> ? A : T extends GroupBuilder<infer U> ? U : never;

type ChildConfigs<T extends Record<string, AnyBuilder>> = {
	[K in keyof T]: Config.Config<ExtractValue<T[K]>>;
};

export function field<A>(meta: FieldMeta, config: Config.Config<A>): FieldBuilder<A> {
	return { def: { kind: "field", ...meta }, config };
}

export function group<const T extends Record<string, AnyBuilder>>(
	description: string,
	children: T,
): GroupBuilder<{ [K in keyof T]: ExtractValue<T[K]> }> {
	// oxlint-disable-next-line no-unsafe-type-assertion
	const childConfigs = Object.fromEntries(
		Object.entries(children).map(([k, v]) => [k, v.config]),
	) as ChildConfigs<T>;

	const childDefs = Object.fromEntries(Object.entries(children).map(([k, v]) => [k, v.def]));

	return {
		def: { kind: "group", description, children: childDefs },
		// oxlint-disable-next-line no-unsafe-type-assertion
		config: Config.all(childConfigs) as Config.Config<{
			[K in keyof T]: ExtractValue<T[K]>;
		}>,
	};
}
