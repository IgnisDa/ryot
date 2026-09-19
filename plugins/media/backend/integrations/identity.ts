import { Schema } from "@ryot-app/sandbox-sdk/effect";

export const integrationRecordId = Schema.encodeSync(
	Schema.fromJsonString(Schema.Array(Schema.Union([Schema.String, Schema.Finite]))),
);
