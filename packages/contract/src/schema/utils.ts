import { Result, Schema } from "effect";

export const strictStruct = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
	Schema.Struct(fields).annotate({ parseOptions: { onExcessProperty: "error" as const } });

const isEmail = (value: string): true | string =>
	/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? true : "must be a valid email address";

const isHttpUrl = (value: string): true | string => {
	const url = Result.try(() => new URL(value.trim()));
	return Result.isSuccess(url) && ["http:", "https:"].includes(url.success.protocol)
		? true
		: "must be a valid http or https URL";
};

export const Email = Schema.String.pipe(Schema.check(Schema.makeFilter(isEmail)));

export const HttpUrl = Schema.String.pipe(Schema.check(Schema.makeFilter(isHttpUrl)));
