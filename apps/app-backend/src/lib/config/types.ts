export type FieldDef = {
	readonly kind: "field";
	readonly envKey: string;
	readonly default?: string;
	readonly optional?: boolean;
	readonly sensitive?: boolean;
	readonly description: string;
};

export interface GroupDef<
	// oxlint-disable-next-line typescript/no-explicit-any
	T extends Record<string, any> = Record<string, ConfigNode>,
> {
	readonly children: T;
	readonly kind: "group";
	readonly description: string;
}

export type ConfigNode = FieldDef | GroupDef;

type ExtractPathsFromNode<T extends ConfigNode, Path extends string> = T extends { kind: "field" }
	? Path
	: T extends {
				kind: "group";
				children: infer C extends Record<string, ConfigNode>;
		  }
		? ExtractPaths<C, Path>
		: never;

export type ExtractPaths<T extends Record<string, ConfigNode>, Prefix extends string = ""> = {
	[K in keyof T & string]: ExtractPathsFromNode<T[K], Prefix extends "" ? K : `${Prefix}.${K}`>;
}[keyof T & string];

type ParsedNode<T extends ConfigNode> = T extends { kind: "field" }
	? string | undefined
	: T extends {
				kind: "group";
				children: infer R extends Record<string, ConfigNode>;
		  }
		? ParsedChildren<R>
		: never;

export type ParsedChildren<T extends Record<string, ConfigNode>> = {
	[K in keyof T]: ParsedNode<T[K]>;
};

type ExtractEnvKeysFromNode<T extends ConfigNode> = T extends {
	kind: "field";
	envKey: infer K extends string;
}
	? K
	: T extends {
				kind: "group";
				children: infer R extends Record<string, ConfigNode>;
		  }
		? { [K in keyof R]: ExtractEnvKeysFromNode<R[K]> }[keyof R]
		: never;

export type ExtractEnvKeys<T extends Record<string, ConfigNode>> = {
	[K in keyof T]: ExtractEnvKeysFromNode<T[K]>;
}[keyof T];

export function field<TEnvKey extends string>(
	envKey: TEnvKey,
	meta: Omit<FieldDef, "kind" | "envKey">,
): FieldDef & { envKey: TEnvKey } {
	return { kind: "field", envKey, ...meta } as FieldDef & { envKey: TEnvKey };
}

export function group<T extends Record<string, ConfigNode>>(
	description: string,
	children: T,
): GroupDef<T> {
	return { kind: "group", description, children };
}
