import { Schema } from "effect";

export const UserId = Schema.String.pipe(Schema.brand("UserId"));

export type UserId = typeof UserId.Type;

const isEmail = (value: string): true | string =>
	/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? true : "must be a valid email address";

export const Email = Schema.String.pipe(Schema.check(Schema.makeFilter(isEmail)));
