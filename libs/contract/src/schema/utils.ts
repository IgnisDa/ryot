import { Either, Schema } from "effect";

export const strictStruct = <Fields extends Record<string, Schema.Struct.Field>>(fields: Fields) =>
	Schema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "error" as const } });

const isEmail = (value: string): true | string =>
	/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? true : "must be a valid email address";

const isHttpUrl = (value: string): true | string => {
	const url = Either.try(() => new URL(value.trim()));
	return Either.isRight(url) && ["http:", "https:"].includes(url.right.protocol)
		? true
		: "must be a valid http or https URL";
};

export const Email = Schema.String.pipe(Schema.filter(isEmail));

export const HttpUrl = Schema.String.pipe(Schema.filter(isHttpUrl));
