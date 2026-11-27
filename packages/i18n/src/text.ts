import { Brand } from "effect";

export type Text = string & Brand.Brand<"Text">;

export const Text = Brand.nominal<Text>();
