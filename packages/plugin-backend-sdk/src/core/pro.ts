import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { hostResultSchema } from "../wire";

export const getProAvailabilityArgsSchema = Schema.Tuple([]);
export const getProAvailabilityResultSchema = hostResultSchema(Schema.Boolean);
