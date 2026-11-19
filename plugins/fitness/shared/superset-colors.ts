import { Schema } from "@ryot-app/plugin-kit/effect";

export const supersetColors = ["blue", "purple", "teal", "orange", "crimson"] as const;

export const SupersetColorSchema = Schema.Literals(supersetColors);
export type SupersetColor = typeof SupersetColorSchema.Type;

export const supersetColor = (color: string): SupersetColor =>
	supersetColors.find((candidate) => candidate === color) ?? "blue";
