import { Effect, Schema } from "effect";
import { Schema as OtherSchema } from "schema-library";

const current = Schema.String.pipe(Schema.withDecodingDefaultType(Effect.sync(() => "")));
const unrelated = OtherSchema.optionalWith(OtherSchema.String, { default: () => "" });
const unrelatedElement = OtherSchema.Tuple(OtherSchema.optionalElement(OtherSchema.String));
const shadowed = (Schema: any) => Schema.optionalWith(Schema.String, { default: () => "" });
const shadowedElement = (Schema: any) => Schema.Tuple(Schema.optionalElement(Schema.String));
const genericShadowed = <Schema>() => Schema.optionalWith(Schema.String, { default: () => "" });
const currentElement = Schema.Tuple(Schema.optionalKey(Schema.String));
const raw = "Schema.optionalWith(Schema.String, { default: () => '' })";

void [current, unrelated, unrelatedElement, shadowed, shadowedElement, currentElement, raw];
