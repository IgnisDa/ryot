import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

export const nonEmptyString = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
