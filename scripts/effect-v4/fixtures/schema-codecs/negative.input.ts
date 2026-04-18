import { Schema } from "effect";
import { Schema as LocalSchema } from "./effect";
import { Schema as OtherSchema } from "other";

const currentDecode = Schema.decodeUnknownEffect(Schema.String);
const currentJson = Schema.fromJsonString(Schema.String);
const sync = Schema.decodeUnknownSync(Schema.String);
const exit = Schema.decodeUnknownExit(Schema.String);
const result = Schema.decodeUnknownResult(Schema.String);
const option = Schema.decodeUnknownOption(Schema.String);
const unrelatedDecode = OtherSchema.decodeUnknown(OtherSchema.String);
const unrelatedResult = OtherSchema.decodeUnknownEither(OtherSchema.String);
const unrelatedJson = OtherSchema.parseJson(OtherSchema.String);
const localOutsideSdk = LocalSchema.decodeUnknown(LocalSchema.String);
const raw = "Schema.decodeUnknown(Schema.String); Schema.parseJson(Schema.String);";
const template = `Schema.decodeUnknown(Schema.String); Schema.parseJson(Schema.String);`;

const parameterShadow = (Schema: any) => Schema.decodeUnknown(Schema.String);
for (const Schema of schemas) Schema.parseJson(Schema.String);
for (const Schema in schemas) Schema.decodeUnknown(Schema.String);
for (let Schema = local; condition; update()) Schema.parseJson(Schema.String);
{
	const Schema = local;
	Schema.decodeUnknown(Schema.String);
}

void [
	currentDecode,
	currentJson,
	sync,
	exit,
	result,
	option,
	unrelatedDecode,
	unrelatedResult,
	unrelatedJson,
	localOutsideSdk,
	raw,
	template,
	parameterShadow,
];
