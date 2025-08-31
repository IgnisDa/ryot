export type FieldDef = {
	readonly _kind: "field";
	readonly envKey: string;
	readonly default?: string;
	readonly optional?: boolean;
	readonly sensitive?: boolean;
	readonly description: string;
};

export interface GroupDef<
	// biome-ignore lint/suspicious/noExplicitAny: recursive generic requires any
	T extends Record<string, any> = Record<string, ConfigNode>,
> {
	readonly children: T;
	readonly _kind: "group";
	readonly description: string;
}

export type ConfigNode = FieldDef | GroupDef;

type ExtractPathsFromNode<
	T extends ConfigNode,
	Path extends string,
> = T extends { _kind: "field" }
	? Path
	: T extends {
				_kind: "group";
				children: infer C extends Record<string, ConfigNode>;
			}
		? ExtractPaths<C, Path>
		: never;

export type ExtractPaths<
	T extends Record<string, ConfigNode>,
	Prefix extends string = "",
> = {
	[K in keyof T & string]: ExtractPathsFromNode<
		T[K],
		Prefix extends "" ? K : `${Prefix}.${K}`
	>;
}[keyof T & string];

type ParsedNode<T extends ConfigNode> = T extends { _kind: "field" }
	? string | undefined
	: T extends {
				_kind: "group";
				children: infer R extends Record<string, ConfigNode>;
			}
		? ParsedChildren<R>
		: never;

export type ParsedChildren<T extends Record<string, ConfigNode>> = {
	[K in keyof T]: ParsedNode<T[K]>;
};

type ExtractEnvKeysFromNode<T extends ConfigNode> = T extends {
	_kind: "field";
	envKey: infer K extends string;
}
	? K
	: T extends {
				_kind: "group";
				children: infer R extends Record<string, ConfigNode>;
			}
		? { [K in keyof R]: ExtractEnvKeysFromNode<R[K]> }[keyof R]
		: never;

export type ExtractEnvKeys<T extends Record<string, ConfigNode>> = {
	[K in keyof T]: ExtractEnvKeysFromNode<T[K]>;
}[keyof T];

export function field<TEnvKey extends string>(
	envKey: TEnvKey,
	meta: Omit<FieldDef, "_kind" | "envKey">,
): FieldDef & { envKey: TEnvKey } {
	return { _kind: "field", envKey, ...meta } as FieldDef & { envKey: TEnvKey };
}

export function group<T extends Record<string, ConfigNode>>(
	description: string,
	children: T,
): GroupDef<T> {
	return { _kind: "group", description, children };
}
