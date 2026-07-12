import { Schema, Effect, SchemaGetter } from "effect";

declare const fallback: () => string;

const empty = Schema.Array(Schema.String).pipe(
    schema => Schema.optional(schema).pipe(Schema.decodeTo(Schema.toType(schema), {
        decode: SchemaGetter.withDefault(Effect.sync(() => [])),
        encode: SchemaGetter.required()
    })),
    Schema.withConstructorDefault(Effect.sync(() => []))
);
const dynamic = Schema.String.pipe(
    schema => Schema.optional(schema).pipe(Schema.decodeTo(Schema.toType(schema), {
        decode: SchemaGetter.withDefault(Effect.sync(() => fallback())),
        encode: SchemaGetter.required()
    })),
    Schema.withConstructorDefault(Effect.sync(() => fallback()))
);
const expression = (condition ? Schema.String : Schema.Number).pipe(
    schema => Schema.optional(schema).pipe(Schema.decodeTo(Schema.toType(schema), {
        decode: SchemaGetter.withDefault(Effect.sync(function() {
            return nextValue();
        })),

        encode: SchemaGetter.required()
    })),
    Schema.withConstructorDefault(Effect.sync(function () {
		return nextValue();
	}))
);

void [empty, dynamic, expression];
