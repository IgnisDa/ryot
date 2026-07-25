import { Schema } from "@ryot-app/plugin-kit/effect";

const optionalNumber = Schema.optional(Schema.NullOr(Schema.Number));

const optionalString = Schema.optional(Schema.NullOr(Schema.String));

const TimeToBeatSchema = Schema.Struct({
	hastily: optionalNumber,
	normally: optionalNumber,
	completely: optionalNumber,
});

const PlatformReleaseSchema = Schema.Struct({
	name: Schema.String,
	releaseDate: optionalString,
	releaseRegion: optionalString,
});

export const TimeToBeatValueSchema = Schema.NullOr(TimeToBeatSchema);

export const PlatformReleaseListSchema = Schema.NullOr(Schema.Array(PlatformReleaseSchema));

export type TimeToBeatValue = Schema.Schema.Type<typeof TimeToBeatValueSchema>;

export type PlatformReleaseList = Schema.Schema.Type<typeof PlatformReleaseListSchema>;
