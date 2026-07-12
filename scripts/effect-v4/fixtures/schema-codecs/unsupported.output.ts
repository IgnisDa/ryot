import { Schema } from "effect";

const decode = Schema.decodeUnknown(Schema.String);
const empty = Schema.parseJson();
const extra = Schema.parseJson(Schema.String, options);
const spread = Schema.parseJson(...schemas);
const computed = Schema["parseJson"](Schema.String);
const optionalMember = Schema?.parseJson(Schema.String);
const optionalCall = Schema.parseJson?.(Schema.String);
const computedResult = Schema["decodeUnknownEither"](Schema.String);
const optionalResultMember = Schema?.decodeUnknownEither(Schema.String);
const optionalResultCall = Schema.decodeUnknownEither?.(Schema.String);

void [
	decode,
	empty,
	extra,
	spread,
	computed,
	optionalMember,
	optionalCall,
	computedResult,
	optionalResultMember,
	optionalResultCall,
];
