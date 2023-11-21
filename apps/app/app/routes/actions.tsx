import { parse } from "@conform-to/zod";
import { ActionFunctionArgs, json, redirect } from "@remix-run/node";
import {
	AddEntityToCollectionDocument,
	CreateReviewCommentDocument,
	EntityLot,
	RemoveEntityFromCollectionDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { namedAction } from "remix-utils/named-action";
import { z } from "zod";
import { gqlClient } from "~/lib/api.server";
import { APP_ROUTES } from "~/lib/constants";
import { authCookie, colorSchemeCookie } from "~/lib/cookies.server";
import { createToastHeaders } from "~/lib/toast.server";

export const loader = () => redirect(APP_ROUTES.dashboard);

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		toggleColorScheme: async () => {
			const currentColorScheme = await colorSchemeCookie.parse(
				request.headers.get("Cookie") || "",
			);
			const newColorScheme = currentColorScheme === "light" ? "dark" : "light";
			return redirect(APP_ROUTES.dashboard, {
				headers: {
					"Set-Cookie": await colorSchemeCookie.serialize(newColorScheme),
				},
			});
		},
		logout: async () => {
			return redirect(APP_ROUTES.auth.login, {
				headers: {
					"Set-Cookie": await authCookie.serialize("", {
						expires: new Date(0),
					}),
				},
			});
		},
		createReviewComment: async () => {
			const submission = parse(formData, { schema: reviewCommentSchema });
			if (submission.intent !== "submit")
				return json({ status: "idle", submission } as const);
			if (!submission.value)
				return json({ status: "error", submission } as const, { status: 400 });
			await gqlClient.request(CreateReviewCommentDocument, {
				input: submission.value,
			});
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					message: "Comment posted successfully",
					type: "success",
				}),
			});
		},
		addMediaToCollection: async () => {
			const submission = parse(formData, {
				schema: changeCollectionToEntitySchema,
			});
			if (submission.intent !== "submit")
				return json({ status: "idle", submission } as const);
			if (!submission.value)
				return json({ status: "error", submission } as const, { status: 400 });
			await gqlClient.request(AddEntityToCollectionDocument, {
				input: submission.value,
			});
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					message: "Media added to collection successfully",
					type: "success",
				}),
			});
		},
		removeMediaFromCollection: async () => {
			const submission = parse(formData, {
				schema: changeCollectionToEntitySchema,
			});
			if (submission.intent !== "submit")
				return json({ status: "idle", submission } as const);
			if (!submission.value)
				return json({ status: "error", submission } as const, { status: 400 });
			await gqlClient.request(RemoveEntityFromCollectionDocument, {
				input: submission.value,
			});
			return json({ status: "success", submission } as const);
		},
	});
};

const formBoolean = z
	.string()
	.optional()
	.transform((v) => v === "1" || v === "true" || v === "on" || v === "yes");

const reviewCommentSchema = z.object({
	reviewId: z.number(),
	commentId: z.string().optional(),
	text: z.string().optional(),
	decrementLikes: formBoolean,
	incrementLikes: formBoolean,
	shouldDelete: formBoolean,
});

const changeCollectionToEntitySchema = z.object({
	collectionName: z.string(),
	entityId: z.string(),
	entityLot: z.nativeEnum(EntityLot),
});
