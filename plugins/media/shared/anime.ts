import { Schema } from "@ryot-app/plugin-kit/effect";

const AiringScheduleEntrySchema = Schema.Struct({
	episode: Schema.Finite,
	airingAt: Schema.String,
});

export const AiringScheduleListSchema = Schema.NullOr(Schema.Array(AiringScheduleEntrySchema));

export type AiringScheduleList = Schema.Schema.Type<typeof AiringScheduleListSchema>;
