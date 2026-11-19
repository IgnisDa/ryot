import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

const encodeRecordId = Schema.encodeEffect(
	Schema.fromJsonString(Schema.Array(Schema.Union([Schema.String, Schema.Finite]))),
);

export const integrationRecordId = (parts: ReadonlyArray<number | string>) =>
	encodeRecordId(parts).pipe(Effect.orDie);
