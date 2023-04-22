import { GraphQLDateTime } from "graphql-scalars";

const RFC_3339_REGEX =
	/^(\d{4}-(0[1-9]|1[012])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9]|60))(\.\d{1,})?(([Z])|([+|-]([01][0-9]|2[0-3]):[0-5][0-9]))$/;

const isDateTimeString = (value: string) => RFC_3339_REGEX.test(value);

const parse = (value: unknown): unknown => {
	if (value === null) {
		return value;
	}
	if (typeof value === "string") {
		if (isDateTimeString(value)) {
			return GraphQLDateTime.parseValue(value);
		}
	}
	if (typeof value === "object") {
		if (Array.isArray(value)) {
			return value.map(parse);
		}
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => {
				return [k, parse(v)];
			}),
		);
	}

	return value;
};

const stringify = (value: unknown): unknown => {
	if (value === null) {
		return value;
	}
	if (value instanceof Date) {
		return GraphQLDateTime.serialize(value);
	}
	if (typeof value === "object") {
		if (Array.isArray(value)) {
			return value.map(stringify);
		}
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => {
				return [k, stringify(v)];
			}),
		);
	}

	return value;
};

export const gqlSerializer = {
	parse: <T = any>(jsonStr: string): T => {
		const jsonValue = JSON.parse(jsonStr);
		return parse(jsonValue) as T;
	},

	stringify: <T = unknown>(obj: T): string => {
		const objWithoutDate = stringify(obj);
		return JSON.stringify(objWithoutDate);
	},
};
