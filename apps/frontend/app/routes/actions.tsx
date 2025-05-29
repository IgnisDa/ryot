import {
	AddEntityToCollectionDocument,
	CreateOrUpdateReviewDocument,
	CreateReviewCommentDocument,
	DeleteReviewDocument,
	DeleteS3ObjectDocument,
	EntityLot,
	ExpireCacheKeyDocument,
	MarkEntityAsPartialDocument,
	RemoveEntityFromCollectionDocument,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import {
	getActionIntent,
	isEmpty,
	omitBy,
	processSubmission,
	zodBoolAsString,
	zodCheckboxAsString,
} from "@ryot/ts-utils";
import { redirect } from "react-router";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { z } from "zod";
import { redirectToQueryParam } from "~/lib/common";
import {
	MetadataSpecificsSchema,
	colorSchemeCookie,
	createToastHeaders,
	extendResponseHeaders,
	getLogoutCookies,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/actions";

export const loader = async () => redirect($path("/"));

export const action = async ({ request }: Route.ActionArgs) => {
	const formData = await request.clone().formData();
	const intent = getActionIntent(request);
	const { searchParams } = new URL(request.url);
	const redirectToSearchParams = searchParams.get(redirectToQueryParam);
	let redirectTo = redirectToSearchParams || undefined;
	let returnData = {};
	const headers = new Headers();
	let status = undefined;
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
		.with("logout", async () => {
			redirectTo = $path("/auth");
			extendResponseHeaders(headers, getLogoutCookies());
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
		.with("addEntityToCollection", async () => {
			const [submission] = getChangeCollectionToEntityVariables(formData);
			const addTo = [submission.collectionName];
			if (submission.collectionName === "Watchlist") addTo.push("Monitoring");
			for (const co of addTo) {
				await serverGqlService.authenticatedRequest(
					request,
					AddEntityToCollectionDocument,
					{
						input: {
							...submission,
							collectionName: co,
							creatorUserId: submission.creatorUserId,
							information: omitBy(submission.information || {}, isEmpty),
						},
					},
				);
			}
			extendResponseHeaders(
				headers,
				await createToastHeaders({
					message: "Media added to collection successfully",
					type: "success",
				}),
			);
		})
		.with("removeEntityFromCollection", async () => {
			const [submission] = getChangeCollectionToEntityVariables(formData);
			await serverGqlService.authenticatedRequest(
				request,
				RemoveEntityFromCollectionDocument,
				{
					input: {
						...submission,
						collectionName: submission.collectionName,
						creatorUserId: submission.creatorUserId,
					},
				},
			);
		})
		.with("performReviewAction", async () => {
			const submission = processSubmission(formData, reviewSchema);
			if (submission.shouldDelete) {
				invariant(submission.reviewId);
				await serverGqlService.authenticatedRequest(
					request,
					DeleteReviewDocument,
					{ reviewId: submission.reviewId },
				);
				extendResponseHeaders(
					headers,
					await createToastHeaders({
						message: "Review deleted successfully",
						type: "success",
					}),
				);
			} else {
				const entityId = submission.entityId;
				const entityLot = submission.entityLot;
				invariant(entityId && entityLot);
				await serverGqlService.authenticatedRequest(
					request,
					CreateOrUpdateReviewDocument,
					{ input: { ...submission, entityId, entityLot } },
				);
				extendResponseHeaders(
					headers,
					await createToastHeaders({
						message: "Review submitted successfully",
						type: "success",
					}),
				);
			}
		})
		.with("bulkCollectionAction", async () => {
			const submission = processSubmission(formData, bulkCollectionAction);
			for (const item of submission.items) {
				await serverGqlService.authenticatedRequest(
					request,
					submission.action === "remove"
						? RemoveEntityFromCollectionDocument
						: AddEntityToCollectionDocument,
					{
						input: {
							...item,
							collectionName: submission.collectionName,
							creatorUserId: submission.creatorUserId,
						},
					},
				);
			}
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
		.with("expireCacheKey", async () => {
			const submission = processSubmission(formData, expireCacheKeySchema);
			await serverGqlService.request(ExpireCacheKeyDocument, {
				cacheId: submission.cacheId,
			});
		})
		.run();
	if (redirectTo) {
		headers.append("Location", redirectTo.toString());
		status = 302;
	}
	return Response.json(returnData, { headers, status });
};

const reviewCommentSchema = z.object({
	reviewId: z.string(),
	text: z.string().optional(),
	commentId: z.string().optional(),
	shouldDelete: zodBoolAsString.optional(),
	decrementLikes: zodBoolAsString.optional(),
	incrementLikes: zodBoolAsString.optional(),
});

const changeCollectionToEntitySchema = z.object({
	entityId: z.string(),
	creatorUserId: z.string(),
	collectionName: z.string(),
	information: z.any().optional(),
	entityLot: z.nativeEnum(EntityLot),
});

const reviewSchema = z
	.object({
		text: z.string().optional(),
		rating: z.string().optional(),
		entityId: z.string().optional(),
		reviewId: z.string().optional(),
		shouldDelete: zodBoolAsString.optional(),
		isSpoiler: zodCheckboxAsString.optional(),
		entityLot: z.nativeEnum(EntityLot).optional(),
		visibility: z.nativeEnum(Visibility).optional(),
	})
	.merge(MetadataSpecificsSchema);

const getChangeCollectionToEntityVariables = (formData: FormData) => {
	const submission = processSubmission(
		formData,
		changeCollectionToEntitySchema,
	);
	return [submission] as const;
};

const bulkCollectionAction = z.object({
	action: z.enum(["remove", "add"]),
	collectionName: z.string(),
	creatorUserId: z.string(),
	items: z.array(
		z.object({
			entityId: z.string(),
			entityLot: z.nativeEnum(EntityLot),
		}),
	),
});

const markEntityAsPartialSchema = z.object({
	entityId: z.string(),
	entityLot: z.nativeEnum(EntityLot),
});

const expireCacheKeySchema = z.object({
	cacheId: z.string().uuid(),
});
