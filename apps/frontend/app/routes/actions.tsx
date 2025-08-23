import {
	CreateReviewCommentDocument,
	DeleteS3ObjectDocument,
	EntityLot,
	MarkEntityAsPartialDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	getActionIntent,
	processSubmission,
	zodBoolAsString,
} from "@ryot/ts-utils";
import { data, redirect } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { z } from "zod";
import {
	colorSchemeCookie,
	createToastHeaders,
	extendResponseHeaders,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/actions";

export const loader = async () => redirect($path("/"));

export const action = async ({ request }: Route.ActionArgs) => {
	const formData = await request.clone().formData();
	const intent = getActionIntent(request);
	let returnData = {};
	const headers = new Headers();
	await match(intent)
		.with("deleteS3Asset", async () => {
			const key = formData.get("key") as string;
			const { deleteS3Object } = await serverGqlService.authenticatedRequest(
				request,
				DeleteS3ObjectDocument,
				{ key },
			);
			returnData = { success: deleteS3Object };
		})
		.with("toggleColorScheme", async () => {
			const currentColorScheme = await colorSchemeCookie.parse(
				request.headers.get("cookie") || "",
			);
			const newColorScheme = currentColorScheme === "dark" ? "light" : "dark";
			headers.append(
				"set-cookie",
				await colorSchemeCookie.serialize(newColorScheme),
			);
		})
		.with("createReviewComment", async () => {
			const submission = processSubmission(formData, reviewCommentSchema);
			await serverGqlService.authenticatedRequest(
				request,
				CreateReviewCommentDocument,
				{ input: submission },
			);
			extendResponseHeaders(
				headers,
				await createToastHeaders({
					message:
						submission.incrementLikes || submission.decrementLikes
							? "Score changed successfully"
							: `Comment ${
									submission.shouldDelete ? "deleted" : "posted"
								} successfully`,
					type: "success",
				}),
			);
		})
		.with("markEntityAsPartial", async () => {
			const submission = processSubmission(formData, markEntityAsPartialSchema);
			await serverGqlService.authenticatedRequest(
				request,
				MarkEntityAsPartialDocument,
				{ input: submission },
			);
			extendResponseHeaders(
				headers,
				await createToastHeaders({
					message: "Entity will be updated in the background",
					type: "success",
				}),
			);
		})
		.run();
	return data(returnData, { headers });
};

const reviewCommentSchema = z.object({
	reviewId: z.string(),
	text: z.string().optional(),
	commentId: z.string().optional(),
	shouldDelete: zodBoolAsString.optional(),
	decrementLikes: zodBoolAsString.optional(),
	incrementLikes: zodBoolAsString.optional(),
});

const markEntityAsPartialSchema = z.object({
	entityId: z.string(),
	entityLot: z.enum(EntityLot),
});
