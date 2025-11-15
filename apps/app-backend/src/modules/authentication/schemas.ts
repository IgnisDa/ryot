import { z } from "@hono/zod-openapi";
import { dataSchema } from "~/lib/openapi";

export const signUpBody = z.object({
	name: z.string().min(1),
	email: z.email().min(1),
	password: z.string().min(8),
});

export const signUpResponseSchema = dataSchema(
	z.object({ created: z.literal(true) }),
);
