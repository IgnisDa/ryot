import { Schema as LocalSchema } from "./effect";

export const value = LocalSchema.String.pipe(LocalSchema.check(LocalSchema.isPattern(/fixture/)));
