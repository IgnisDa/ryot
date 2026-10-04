import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

export const integrationRecordId = Schema.encodeSync(
	Schema.fromJsonString(Schema.Array(Schema.Union([Schema.String, Schema.Finite]))),
);
