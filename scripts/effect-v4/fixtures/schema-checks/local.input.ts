import { Schema as LocalSchema } from "./effect";

export const value = LocalSchema.String.pipe(LocalSchema.pattern(/fixture/));
