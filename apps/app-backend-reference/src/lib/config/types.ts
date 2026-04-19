export type FieldDef = {
	readonly kind: "field";
	readonly envKey: string;
	readonly default?: string;
	readonly optional?: boolean;
	readonly sensitive?: boolean;
	readonly description: string;
};

export interface GroupDef<T extends Record<string, unknown> = Record<string, ConfigNode>> {
	readonly children: T;
	readonly kind: "group";
	readonly description: string;
}

export type ConfigNode = FieldDef | GroupDef;
