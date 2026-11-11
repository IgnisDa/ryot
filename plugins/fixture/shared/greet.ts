import { Schema } from "@ryot-app/plugin-kit/effect";

export const GreetInput = Schema.Struct({ name: Schema.NonEmptyString });
export const GreetOutput = Schema.Struct({ greeting: Schema.String });
