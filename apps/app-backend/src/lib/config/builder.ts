import type { Option } from "effect";
import { Config, Redacted } from "effect";

export type FieldMeta = {
	kind: "field";
	envKey: string;
	hidden: boolean;
	required: boolean;
	sensitive: boolean;
	description: string;
	default: string | undefined;
};

export interface GroupMeta<C extends Record<string, AnyMeta> = Record<string, AnyMeta>> {
	children: C;
	kind: "group";
	description: string;
}

export type AnyMeta = FieldMeta | GroupMeta;

export type ConfigLeaf<A, M extends AnyMeta = AnyMeta> = {
	readonly meta: M;
	readonly config: Config.Config<A>;
};

type FieldOptions<D> = { default?: D; hidden?: boolean; sensitive?: boolean };

const makeFieldMeta = (
	envKey: string,
	description: string,
	defaultStr: string | undefined,
	hidden: boolean,
	sensitive: boolean,
): FieldMeta => ({
	envKey,
	hidden,
	sensitive,
	description,
	kind: "field",
	default: defaultStr,
	required: defaultStr === undefined,
});

export const strField = (
	envKey: string,
	description: string,
	opts?: FieldOptions<string>,
): ConfigLeaf<string, FieldMeta> => {
	const base = Config.string(envKey);
	const config = opts?.default !== undefined ? base.pipe(Config.withDefault(opts.default)) : base;
	return {
		config,
		meta: makeFieldMeta(
			envKey,
			description,
			opts?.default,
			opts?.hidden ?? false,
			opts?.sensitive ?? false,
		),
	};
};

export const secretField = (
	envKey: string,
	description: string,
	opts?: FieldOptions<string>,
): ConfigLeaf<Redacted.Redacted, FieldMeta> => {
	const base = Config.redacted(envKey);
	const config =
		opts?.default !== undefined ? base.pipe(Config.withDefault(Redacted.make(opts.default))) : base;
	return {
		config,
		meta: makeFieldMeta(
			envKey,
			description,
			opts?.default,
			opts?.hidden ?? false,
			opts?.sensitive ?? true,
		),
	};
};

export const boolField = (
	envKey: string,
	description: string,
	opts?: FieldOptions<boolean>,
): ConfigLeaf<boolean, FieldMeta> => {
	const base = Config.boolean(envKey);
	const config = opts?.default !== undefined ? base.pipe(Config.withDefault(opts.default)) : base;
	return {
		config,
		meta: makeFieldMeta(
			envKey,
			description,
			opts?.default?.toString(),
			opts?.hidden ?? false,
			opts?.sensitive ?? false,
		),
	};
};

export const intField = (
	envKey: string,
	description: string,
	opts?: FieldOptions<number>,
): ConfigLeaf<number, FieldMeta> => {
	const base = Config.integer(envKey);
	const config = opts?.default !== undefined ? base.pipe(Config.withDefault(opts.default)) : base;
	return {
		config,
		meta: makeFieldMeta(
			envKey,
			description,
			opts?.default?.toString(),
			opts?.hidden ?? false,
			opts?.sensitive ?? false,
		),
	};
};

export const optField = <A>(
	base: ConfigLeaf<A, FieldMeta>,
): ConfigLeaf<Option.Option<A>, FieldMeta> => ({
	config: base.config.pipe(Config.option),
	meta: { ...base.meta, required: false, default: undefined },
});

export const group = <A, T extends Record<string, AnyMeta>>(
	description: string,
	config: Config.Config<A>,
	children: T,
): ConfigLeaf<A, GroupMeta<T>> => ({
	config,
	meta: { kind: "group", description, children },
});
