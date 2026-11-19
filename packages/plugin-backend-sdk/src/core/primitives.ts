import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { jsonValueSchema } from "../wire";

export const nonEmptyString = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
export const sandboxIdSchema = nonEmptyString;
export const globalPropertiesSchema = Schema.Record(Schema.String, jsonValueSchema);
