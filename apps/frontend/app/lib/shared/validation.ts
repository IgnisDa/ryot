import { isString } from "@ryot/ts-utils";
import { z } from "zod";
import { convertTimestampToUtcString } from "./date-utils";

export const zodCommaDelimitedString = z
	.string()
	.optional()
	.transform((v) => (isString(v) ? v.split(",") : undefined));

export const zodDateTimeString = z
	.string()
	.transform((v) => convertTimestampToUtcString(v));

export const passwordConfirmationSchema = z
	.object({
		confirm: z.string(),
		password: z
			.string()
			.min(8, "Password should be at least 8 characters long"),
	})
	.refine((data) => data.password === data.confirm, {
		error: "Passwords do not match",
		path: ["confirm"],
	});
