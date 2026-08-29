import { Result, Schema } from "effect";

const excessProperty = Schema.Never.annotate({ identifier: "no excess property" });

export const strictStruct = <Fields extends Schema.Struct.Fields>(
	fields: Fields,
): Schema.Struct<Fields> => {
	const declared = new Set(Object.keys(fields));
	const struct = Schema.Struct(fields);
	const excessKey = Schema.String.check(
		Schema.makeFilter((key: string) => (declared.has(key) ? "declared property" : undefined)),
	);
	const strict = Schema.StructWithRest(struct, [Schema.Record(excessKey, excessProperty)]);
	return struct.rebuild(strict.ast);
};

export const IsoUtcString = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter(
			(value) =>
				/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
				!Number.isNaN(Date.parse(value)),
		),
	),
);

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
