import { Schema as LocalSchema } from "./effect";

const decode = LocalSchema.decodeUnknown(LocalSchema.String);
const result = LocalSchema.decodeUnknownEither(LocalSchema.String);
const json = LocalSchema.parseJson(LocalSchema.String);

void [decode, result, json];
