import { Schema as LocalSchema } from "./effect";

const decode = LocalSchema.decodeUnknownEffect(LocalSchema.String);
const result = LocalSchema.decodeUnknownResult(LocalSchema.String);
const json = LocalSchema.fromJsonString(LocalSchema.String);

void [decode, result, json];
