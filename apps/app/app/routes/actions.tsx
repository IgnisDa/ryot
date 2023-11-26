import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	json,
	redirect,
} from "@remix-run/node";
import {
	AddEntityToCollectionDocument,
	CommitMediaDocument,
	CreateReviewCommentDocument,
	EntityLot,
	MetadataLot,
	MetadataSource,
	RemoveEntityFromCollectionDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { $path } from "remix-routes";
import { namedAction } from "remix-utils/named-action";
import { safeRedirect } from "remix-utils/safe-redirect";
import { z } from "zod";
import { zx } from "zodix";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { authCookie, colorSchemeCookie } from "~/lib/cookies.server";
import { createToastHeaders } from "~/lib/toast.server";
import { processSubmission } from "~/lib/utils";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const url = new URL(request.url);
	const intent = url.searchParams.get("intent");
	if (intent === "commitMedia") {
		const values = zx.parseQuery(url.searchParams, {
			identifier: z.string(),
			lot: z.nativeEnum(MetadataLot),
			source: z.nativeEnum(MetadataSource),
			redirectTo: z.string().optional(),
			returnRaw: zx.BoolAsString.optional(),
		});
		const { commitMedia } = await gqlClient.request(
			CommitMediaDocument,
			{ identifier: values.identifier, lot: values.lot, source: values.source },
			await getAuthorizationHeader(request),
		);
		if (values.returnRaw) return json(commitMedia);
		return redirect(
			values.redirectTo
				? safeRedirect(values.redirectTo)
				: $path("/media/item/:id", { id: commitMedia.id.toString() }),
		);
	}
	return redirect($path("/"));
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		toggleColorScheme: async () => {
			const currentColorScheme = await colorSchemeCookie.parse(
				request.headers.get("Cookie") || "",
			);
			const newColorScheme = currentColorScheme === "light" ? "dark" : "light";
			return redirect($path("/"), {
				headers: {
					"Set-Cookie": await colorSchemeCookie.serialize(newColorScheme),
				},
			});
		},
		logout: async () => {
			return redirect($path("/auth/login"), {
				headers: {
					"Set-Cookie": await authCookie.serialize("", {
						expires: new Date(0),
					}),
				},
			});
		},
		createReviewComment: async () => {
			const submission = processSubmission(formData, reviewCommentSchema);
			await gqlClient.request(CreateReviewCommentDocument, {
				input: submission,
			});
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					message: "Comment posted successfully",
					type: "success",
				}),
			});
		},
		addMediaToCollection: async () => {
			const submission = processSubmission(
				formData,
				changeCollectionToEntitySchema,
			);
			await gqlClient.request(
				AddEntityToCollectionDocument,
				{ input: submission },
				await getAuthorizationHeader(request),
			);
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					message: "Media added to collection successfully",
					type: "success",
				}),
			});
		},
		removeMediaFromCollection: async () => {
			const submission = processSubmission(
				formData,
				changeCollectionToEntitySchema,
			);
			await gqlClient.request(RemoveEntityFromCollectionDocument, {
				input: submission,
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
