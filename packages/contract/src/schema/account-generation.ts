import { Schema } from "effect";

import { UserId } from "./brands";

export const AccountGeneration = Schema.Struct({ userId: UserId, token: Schema.String });
export type AccountGeneration = typeof AccountGeneration.Type;
