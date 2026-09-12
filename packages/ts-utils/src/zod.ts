import { z } from "zod";

export const zodBoolAsString = z
	.string()
	.regex(/^(true|false)$/, 'Must be a boolean string ("true" or "false")')
	.transform((value) => value === "true");
