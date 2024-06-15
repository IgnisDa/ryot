import { $path } from "@ignisda/remix-routes";
import {
	redirect,
	unstable_defineAction,
	unstable_parseMultipartFormData,
} from "@remix-run/node";
import {
	AddEntityToCollectionDocument,
	CommitMetadataDocument,
	CommitMetadataGroupDocument,
	CommitPersonDocument,
	CreateReviewCommentDocument,
	DeleteReviewDocument,
	DeleteS3ObjectDocument,
	EntityLot,
	MediaLot,
	MediaSource,
	PostReviewDocument,
	RemoveEntityFromCollectionDocument,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import { isEmpty, omitBy } from "@ryot/ts-utils";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { redirectToQueryParam } from "~/lib/generals";
import {
	MetadataSpecificsSchema,
	colorSchemeCookie,
	createToastHeaders,
	extendResponseHeaders,
	getAuthorizationHeader,
	getLogoutCookies,
	gqlClient,
	processSubmission,
	s3FileUploader,
} from "~/lib/utilities.server";

export const loader = async () => redirect($path("/"));

export const action = unstable_defineAction(async ({ request, response }) => {
	const formData = await request.clone().formData();
	const url = new URL(request.url);
	const intent = url.searchParams.get("intent") as string;
	invariant(intent, "No intent provided");
	const redirectToForm = formData.get(redirectToQueryParam);
	let redirectTo = redirectToForm ? redirectToForm.toString() : undefined;
	let returnData = {};
	await match(intent)
		.with("commitMedia", async () => {
			const submission = processSubmission(formData, commitMediaSchema);
			const { commitMetadata } = await gqlClient.request(
				CommitMetadataDocument,
				{ input: submission },
				await getAuthorizationHeader(request),
			);
			returnData = { commitMedia: commitMetadata };
		})
		.with("uploadWorkoutAsset", async () => {
			const uploader = s3FileUploader("workouts");
			const formData = await unstable_parseMultipartFormData(request, uploader);
			const fileKey = formData.get("file");
			returnData = { key: fileKey };
		})
		.with("deleteS3Asset", async () => {
			const key = formData.get("key") as string;
			const { deleteS3Object } = await gqlClient.request(
				DeleteS3ObjectDocument,
				{ key },
			);
			returnData = { success: deleteS3Object };
		})
		.with("commitPerson", async () => {
			const submission = processSubmission(formData, commitPersonSchema);
			const { commitPerson } = await gqlClient.request(
				CommitPersonDocument,
				{
					input: {
						identifier: submission.identifier,
						name: submission.name,
						source: submission.source,
						sourceSpecifics: {
							isAnilistStudio: submission.isAnilistStudio,
							isTmdbCompany: submission.isTmdbCompany,
						},
					},
				},
				await getAuthorizationHeader(request),
			);
			returnData = { commitPerson };
		})
		.with("commitMetadataGroup", async () => {
			const submission = processSubmission(formData, commitMediaSchema);
			const { commitMetadataGroup } = await gqlClient.request(
				CommitMetadataGroupDocument,
				{ input: submission },
				await getAuthorizationHeader(request),
			);
			returnData = { commitMetadataGroup };
		})
		.with("toggleColorScheme", async () => {
			const currentColorScheme = await colorSchemeCookie.parse(
				request.headers.get("cookie") || "",
			);
			const newColorScheme = currentColorScheme === "dark" ? "light" : "dark";
			response.headers.append(
				"set-cookie",
				await colorSchemeCookie.serialize(newColorScheme),
			);
		})
		.with("logout", async () => {
			redirectTo = $path("/auth");
			response.headers = extendResponseHeaders(
				response.headers,
				await getLogoutCookies(),
			);
		})
		.with("createReviewComment", async () => {
			const submission = processSubmission(formData, reviewCommentSchema);
			await gqlClient.request(
				CreateReviewCommentDocument,
				{ input: submission },
				await getAuthorizationHeader(request),
			);
			response.headers = extendResponseHeaders(
				response.headers,
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
			const [submission, input] =
				getChangeCollectionToEntityVariables(formData);
			const addTo = [submission.collectionName];
			if (submission.collectionName === "Watchlist") addTo.push("Monitoring");
			for (const co of addTo) {
				await gqlClient.request(
					AddEntityToCollectionDocument,
					{
						input: {
							...input,
							collectionName: co,
							creatorUserId: submission.creatorUserId,
							information: omitBy(submission.information || {}, isEmpty),
						},
					},
					await getAuthorizationHeader(request),
				);
			}
			response.headers = extendResponseHeaders(
				response.headers,
				await createToastHeaders({
					message: "Media added to collection successfully",
					type: "success",
				}),
			);
		})
		.with("removeEntityFromCollection", async () => {
			const [submission, input] =
				getChangeCollectionToEntityVariables(formData);
			await gqlClient.request(
				RemoveEntityFromCollectionDocument,
				{
					input: {
						...input,
						collectionName: submission.collectionName,
						creatorUserId: submission.creatorUserId,
					},
				},
				await getAuthorizationHeader(request),
			);
		})
		.with("performReviewAction", async () => {
			const submission = processSubmission(formData, reviewSchema);
			if (submission.shouldDelete) {
				invariant(submission.reviewId, "No reviewId provided");
				await gqlClient.request(
					DeleteReviewDocument,
					{ reviewId: submission.reviewId },
					await getAuthorizationHeader(request),
				);
				response.headers = extendResponseHeaders(
					response.headers,
					await createToastHeaders({
						message: "Review deleted successfully",
						type: "success",
					}),
				);
			} else {
				await gqlClient.request(
					PostReviewDocument,
					{ input: submission },
					await getAuthorizationHeader(request),
				);
				response.headers = extendResponseHeaders(
					response.headers,
					await createToastHeaders({
						message: "Review submitted successfully",
						type: "success",
					}),
				);
			}
		})
		.run();
	if (redirectTo) {
		response.headers.append("Location", redirectTo.toString());
		response.status = 302;
	}
	return Response.json(returnData);
});

const commitMediaSchema = z.object({
	identifier: z.string(),
	lot: z.nativeEnum(MediaLot),
	source: z.nativeEnum(MediaSource),
});

const commitPersonSchema = z.object({
	identifier: z.string(),
	source: z.nativeEnum(MediaSource),
	name: z.string(),
	isTmdbCompany: zx.BoolAsString.optional(),
	isAnilistStudio: zx.BoolAsString.optional(),
});

const reviewCommentSchema = z.object({
	reviewId: z.string(),
	commentId: z.string().optional(),
	text: z.string().optional(),
	decrementLikes: zx.BoolAsString.optional(),
	incrementLikes: zx.BoolAsString.optional(),
	shouldDelete: zx.BoolAsString.optional(),
});

const changeCollectionToEntitySchema = z.object({
	collectionName: z.string(),
	creatorUserId: z.string(),
	entityId: z.string(),
	entityLot: z.nativeEnum(EntityLot),
});

const reviewSchema = z
	.object({
		shouldDelete: zx.BoolAsString.optional(),
		rating: z.string().optional(),
		text: z.string().optional(),
		visibility: z.nativeEnum(Visibility).optional(),
		isSpoiler: zx.CheckboxAsString.optional(),
		metadataId: z.string().optional(),
		metadataGroupId: z.string().optional(),
		collectionId: z.string().optional(),
		personId: z.string().optional(),
		reviewId: z.string().optional(),
	})
	.merge(MetadataSpecificsSchema);

const getChangeCollectionToEntityVariables = (formData: FormData) => {
	const submission = processSubmission(
		formData,
		changeCollectionToEntitySchema.passthrough(),
	);
	const metadataId =
		submission.entityLot === EntityLot.Media ? submission.entityId : undefined;
	const metadataGroupId =
		submission.entityLot === EntityLot.MediaGroup
			? submission.entityId
			: undefined;
	const personId =
		submission.entityLot === EntityLot.Person ? submission.entityId : undefined;
	const exerciseId =
		submission.entityLot === EntityLot.Exercise
			? submission.entityId
			: undefined;
	return [
		submission,
		{
			metadataId,
			metadataGroupId,
			exerciseId,
			personId,
		},
	] as const;
};
