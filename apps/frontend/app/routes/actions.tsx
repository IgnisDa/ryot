import { $path } from "@ignisda/remix-routes";
import {
	type ActionFunctionArgs,
	json,
	redirect,
	unstable_parseMultipartFormData,
} from "@remix-run/node";
import {
	AddEntityToCollectionDocument,
	CommitMetadataDocument,
	CommitMetadataGroupDocument,
	CommitPersonDocument,
	CreateMediaReminderDocument,
	CreateReviewCommentDocument,
	DeleteMediaReminderDocument,
	DeleteReviewDocument,
	DeleteS3ObjectDocument,
	EntityLot,
	MediaLot,
	MediaSource,
	PostReviewDocument,
	RemoveEntityFromCollectionDocument,
	ToggleMediaOwnershipDocument,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { redirectToQueryParam } from "~/lib/generals";
import {
	MetadataSpecificsSchema,
	colorSchemeCookie,
	createToastHeaders,
	getAuthorizationHeader,
	getLogoutCookies,
	gqlClient,
	processSubmission,
	s3FileUploader,
} from "~/lib/utilities.server";

export const loader = async () => redirect($path("/"));

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	const url = new URL(request.url);
	const intent = url.searchParams.get("intent") as string;
	invariant(intent, "No intent provided");
	let redirectTo = (formData.get(redirectToQueryParam) as string) || "/";
	let headers = {};
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
			headers = {
				"set-cookie": await colorSchemeCookie.serialize(newColorScheme),
			};
		})
		.with("logout", async () => {
			redirectTo = $path("/auth/login");
			headers = await getLogoutCookies();
		})
		.with("createReviewComment", async () => {
			const submission = processSubmission(formData, reviewCommentSchema);
			await gqlClient.request(
				CreateReviewCommentDocument,
				{ input: submission },
				await getAuthorizationHeader(request),
			);
			headers = await createToastHeaders({
				message:
					submission.incrementLikes || submission.decrementLikes
						? "Score changed successfully"
						: `Comment ${
								submission.shouldDelete ? "deleted" : "posted"
						  } successfully`,
				type: "success",
			});
		})
		.with("addEntityToCollection", async () => {
			const [submission, input] =
				getChangeCollectionToEntityVariables(formData);
			for (const collectionName of submission.collectionName) {
				const addTo = [collectionName];
				if (collectionName === "Watchlist") addTo.push("Monitoring");
				for (const co of addTo) {
					await gqlClient.request(
						AddEntityToCollectionDocument,
						{ input: { ...input, collectionName: co } },
						await getAuthorizationHeader(request),
					);
				}
			}
			headers = await createToastHeaders({
				message: "Media added to collection successfully",
				type: "success",
			});
		})
		.with("removeEntityFromCollection", async () => {
			const [submission, input] =
				getChangeCollectionToEntityVariables(formData);
			for (const collectionName of submission.collectionName) {
				await gqlClient.request(
					RemoveEntityFromCollectionDocument,
					{ input: { ...input, collectionName } },
					await getAuthorizationHeader(request),
				);
			}
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
				headers = await createToastHeaders({
					message: "Review deleted successfully",
					type: "success",
				});
			} else {
				await gqlClient.request(
					PostReviewDocument,
					{ input: submission },
					await getAuthorizationHeader(request),
				);
				headers = await createToastHeaders({
					message: "Review submitted successfully",
					type: "success",
				});
			}
		})
		.with("createMediaReminder", async () => {
			const submission = processSubmission(formData, createMediaReminderSchema);
			const { createMediaReminder } = await gqlClient.request(
				CreateMediaReminderDocument,
				{ input: submission },
				await getAuthorizationHeader(request),
			);
			headers = await createToastHeaders({
				type: !createMediaReminder ? "error" : undefined,
				message: !createMediaReminder
					? "Reminder was not created"
					: "Reminder created successfully",
			});
		})
		.with("deleteMediaReminder", async () => {
			const submission = processSubmission(
				formData,
				metadataOrPersonOrMetadataGroupIdSchema,
			);
			await gqlClient.request(
				DeleteMediaReminderDocument,
				{ input: submission },
				await getAuthorizationHeader(request),
			);
			headers = await createToastHeaders({
				type: "success",
				message: "Reminder deleted successfully",
			});
		})
		.with("toggleMediaOwnership", async () => {
			const submission = processSubmission(
				formData,
				metadataOrPersonOrMetadataGroupIdSchema,
			);
			await gqlClient.request(
				ToggleMediaOwnershipDocument,
				{ input: submission },
				await getAuthorizationHeader(request),
			);
			headers = await createToastHeaders({
				type: "success",
				message: "Ownership toggled successfully",
			});
		})
		.run();
	if (Object.keys(returnData).length > 0) return json(returnData, { headers });
	return redirect(redirectTo, { headers });
};

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
	reviewId: zx.IntAsString,
	commentId: z.string().optional(),
	text: z.string().optional(),
	decrementLikes: zx.BoolAsString.optional(),
	incrementLikes: zx.BoolAsString.optional(),
	shouldDelete: zx.BoolAsString.optional(),
});

const changeCollectionToEntitySchema = z.object({
	collectionName: z.string().transform((v) => v.split(",")),
	entityId: z.string(),
	entityLot: z.nativeEnum(EntityLot),
});

const reviewSchema = z
	.object({
		shouldDelete: zx.BoolAsString.optional(),
		rating: z.string().optional(),
		text: z.string().optional(),
		visibility: z.nativeEnum(Visibility).optional(),
		spoiler: zx.CheckboxAsString.optional(),
		metadataId: zx.IntAsString.optional(),
		metadataGroupId: zx.IntAsString.optional(),
		collectionId: zx.IntAsString.optional(),
		personId: zx.IntAsString.optional(),
		reviewId: zx.IntAsString.optional(),
	})
	.merge(MetadataSpecificsSchema);

const metadataOrPersonOrMetadataGroupIdSchema = z.object({
	metadataId: zx.IntAsString.optional(),
	metadataGroupId: zx.IntAsString.optional(),
	personId: zx.IntAsString.optional(),
});

const createMediaReminderSchema = z
	.object({ message: z.string(), remindOn: z.string() })
	.merge(metadataOrPersonOrMetadataGroupIdSchema);

const getChangeCollectionToEntityVariables = (formData: FormData) => {
	const submission = processSubmission(
		formData,
		changeCollectionToEntitySchema,
	);
	const metadataId =
		submission.entityLot === EntityLot.Media
			? Number(submission.entityId)
			: undefined;
	const metadataGroupId =
		submission.entityLot === EntityLot.MediaGroup
			? Number(submission.entityId)
			: undefined;
	const personId =
		submission.entityLot === EntityLot.Person
			? Number(submission.entityId)
			: undefined;
	const exerciseId =
		submission.entityLot === EntityLot.Exercise
			? submission.entityId
			: undefined;
	return [
		submission,
		{ metadataId, metadataGroupId, exerciseId, personId },
	] as const;
};
