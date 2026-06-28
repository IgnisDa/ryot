import { Schema } from "effect";
import { Schema as OtherSchema } from "other";
import * as Effect from "effect";

const current = Schema.Number.pipe(Schema.check(Schema.isInt()));
const currentString = Schema.String.pipe(Schema.check(Schema.isNonEmpty()));
const other = OtherSchema.String.pipe(OtherSchema.minLength(1));
const namespace = Effect.Schema.String.pipe(Effect.Schema.minLength(1));
const alias = Schema.minLength;
const raw = "Schema.int(); Schema.minLength(1);";
const template = `Schema.pattern(/fixture/)`;

const parameter = (Schema: any) => Schema.int();
for (const Schema of schemas) Schema.minLength(1);
for (let Schema = local; condition; update()) Schema.pattern(/fixture/);
