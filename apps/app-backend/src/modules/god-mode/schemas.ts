import { z } from "@hono/zod-openapi";

import { dataSchema } from "~/lib/openapi";

export const authStateSchema = z.enum(["credential", "oidc", "none", "mixed"]);

export type AuthState = z.infer<typeof authStateSchema>;

export const userListItemSchema = z.object({
	id: z.string(),
	name: z.string(),
	email: z.email(),
	createdAt: z.string(),
	authState: authStateSchema,
	twoFactorEnabled: z.boolean().nullable(),
});

export type UserListItem = z.infer<typeof userListItemSchema>;

export const userListResponseSchema = dataSchema(
	z.object({
		total: z.number().int().nonnegative(),
		users: z.array(userListItemSchema),
	}),
);

export const userListQuerySchema = z.object({
	search: z.string().optional(),
	offset: z.coerce.number().int().min(0).default(0),
	limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type UserListQuery = z.infer<typeof userListQuerySchema>;

export const resetPasswordResponseSchema = dataSchema(
	z.object({ email: z.email(), resetUrl: z.string() }),
);

export type ResetPasswordResponse = z.infer<typeof resetPasswordResponseSchema>;

export const resetPasswordPathParamsSchema = z.object({
	userId: z.string(),
});
