import { Result, Schema } from "effect";
import { Base64 } from "effect/encoding";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeSync(Schema.fromJsonString(Schema.Json));

export const hostCallArgs = (value: unknown) =>
	Base64.encode(new TextEncoder().encode(encodeJson(value)));

export const decodedHostCallArgs = (encoded: string) =>
	decodeJson(new TextDecoder().decode(Result.getOrThrow(Base64.decode(encoded))));
