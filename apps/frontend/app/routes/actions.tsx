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
	CreateUserMeasurementDocument,
	DeleteReviewDocument,
	DeleteS3ObjectDocument,
	DeployBulkProgressUpdateDocument,
	EntityLot,
	MediaLot,
	MediaSource,
	PostReviewDocument,
	RemoveEntityFromCollectionDocument,
	SeenState,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import { isEmpty, omitBy, set } from "@ryot/ts-utils";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import {
	convertEntityToIndividualId,
	redirectToQueryParam,
} from "~/lib/generals";
import {
	MetadataIdSchema,
	MetadataSpecificsSchema,
	colorSchemeCookie,
	createToastHeaders,
	extendResponseHeaders,
	getAuthorizationHeader,
	getLogoutCookies,
	processSubmission,
	removeCachedUserCollectionsList,
	s3FileUploader,
	serverGqlService,
} from "~/lib/utilities.server";

export const loader = async () => redirect($path("/"));

export const action = unstable_defineAction(async ({ request, response }) => {
	const formData = await request.clone().formData();
	const url = new URL(request.url);
	const intent = url.searchParams.get("intent") as string;
	invariant(intent);
	const redirectToForm = formData.get(redirectToQueryParam);
	let redirectTo = redirectToForm ? redirectToForm.toString() : undefined;
	let returnData = {};
	await match(intent)
		.with("commitMedia", async () => {
			const submission = processSubmission(formData, commitMediaSchema);
			const { commitMetadata } = await serverGqlService.request(
				CommitMetadataDocument,
				{ input: submission },
				getAuthorizationHeader(request),
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
			const { deleteS3Object } = await serverGqlService.request(
				DeleteS3ObjectDocument,
				{ key },
			);
			returnData = { success: deleteS3Object };
		})
		.with("commitPerson", async () => {
			const submission = processSubmission(formData, commitPersonSchema);
			const { commitPerson } = await serverGqlService.request(
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
				getAuthorizationHeader(request),
			);
			returnData = { commitPerson };
		})
		.with("commitMetadataGroup", async () => {
			const submission = processSubmission(formData, commitMediaSchema);
			const { commitMetadataGroup } = await serverGqlService.request(
				CommitMetadataGroupDocument,
				{ input: submission },
				getAuthorizationHeader(request),
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
				getLogoutCookies(),
			);
		})
		.with("createReviewComment", async () => {
			const submission = processSubmission(formData, reviewCommentSchema);
			await serverGqlService.request(
				CreateReviewCommentDocument,
				{ input: submission },
				getAuthorizationHeader(request),
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
			removeCachedUserCollectionsList(request);
			const [submission, input] =
				getChangeCollectionToEntityVariables(formData);
			const addTo = [submission.collectionName];
			if (submission.collectionName === "Watchlist") addTo.push("Monitoring");
			for (const co of addTo) {
				await serverGqlService.request(
					AddEntityToCollectionDocument,
					{
						input: {
							...input,
							collectionName: co,
							creatorUserId: submission.creatorUserId,
							information: omitBy(submission.information || {}, isEmpty),
						},
					},
					getAuthorizationHeader(request),
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
			removeCachedUserCollectionsList(request);
			const [submission, input] =
				getChangeCollectionToEntityVariables(formData);
			await serverGqlService.request(
				RemoveEntityFromCollectionDocument,
				{
					input: {
						...input,
						collectionName: submission.collectionName,
						creatorUserId: submission.creatorUserId,
					},
				},
				getAuthorizationHeader(request),
			);
		})
		.with("performReviewAction", async () => {
			const submission = processSubmission(formData, reviewSchema);
			if (submission.shouldDelete) {
				invariant(submission.reviewId);
				await serverGqlService.request(
					DeleteReviewDocument,
					{ reviewId: submission.reviewId },
					getAuthorizationHeader(request),
				);
				response.headers = extendResponseHeaders(
					response.headers,
					await createToastHeaders({
						message: "Review deleted successfully",
						type: "success",
					}),
				);
			} else {
				await serverGqlService.request(
					PostReviewDocument,
					{ input: submission },
					getAuthorizationHeader(request),
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
		.with("progressUpdate", async () => {
			const submission = processSubmission(formData, progressUpdateSchema);
			const variables = {
				metadataId: submission.metadataId,
				progress: "100",
				date: submission.date,
				showSeasonNumber: submission.showSeasonNumber,
				showEpisodeNumber: submission.showEpisodeNumber,
				podcastEpisodeNumber: submission.podcastEpisodeNumber,
				animeEpisodeNumber: submission.animeEpisodeNumber,
				mangaChapterNumber: submission.mangaChapterNumber,
				mangaVolumeNumber: submission.mangaVolumeNumber,
				providerWatchedOn: submission.providerWatchedOn,
			};
			let needsFinalUpdate = true;
			const updates = [];
			const showSpecifics = showSpecificsSchema.parse(
				JSON.parse(submission.showSpecifics || "[]"),
			);
			const podcastSpecifics = podcastSpecificsSchema.parse(
				JSON.parse(submission.podcastSpecifics || "[]"),
			);
			if (submission.metadataLot === MediaLot.Anime) {
				if (submission.animeEpisodeNumber) {
					if (submission.animeAllEpisodesBefore) {
						for (let i = 1; i <= submission.animeEpisodeNumber; i++) {
							updates.push({
								...variables,
								animeEpisodeNumber: i,
							});
						}
						needsFinalUpdate = false;
					}
				}
			}
			if (submission.metadataLot === MediaLot.Manga) {
				if (submission.mangaChapterNumber) {
					if (submission.mangaAllChaptersBefore) {
						for (let i = 1; i <= submission.mangaChapterNumber; i++) {
							updates.push({
								...variables,
								mangaChapterNumber: i,
							});
						}
						needsFinalUpdate = false;
					}
				}
			}
			if (submission.metadataLot === MediaLot.Show) {
				if (submission.completeShow) {
					for (const season of showSpecifics) {
						for (const episode of season.episodes) {
							updates.push({
								...variables,
								showSeasonNumber: season.seasonNumber,
								showEpisodeNumber: episode,
							});
						}
					}
					needsFinalUpdate = false;
				}
				if (submission.onlySeason) {
					const selectedSeason = showSpecifics.find(
						(s) => s.seasonNumber === submission.showSeasonNumber,
					);
					invariant(selectedSeason);
					needsFinalUpdate = false;
					if (submission.showAllSeasonsBefore) {
						for (const season of showSpecifics) {
							if (season.seasonNumber > selectedSeason.seasonNumber) break;
							for (const episode of season.episodes || []) {
								updates.push({
									...variables,
									showSeasonNumber: season.seasonNumber,
									showEpisodeNumber: episode,
								});
							}
						}
					} else {
						for (const episode of selectedSeason.episodes || []) {
							updates.push({
								...variables,
								showEpisodeNumber: episode,
							});
						}
					}
				}
			}
			if (submission.metadataLot === MediaLot.Podcast) {
				if (submission.completePodcast) {
					for (const episode of podcastSpecifics) {
						updates.push({
							...variables,
							podcastEpisodeNumber: episode.episodeNumber,
						});
					}
					needsFinalUpdate = false;
				}
			}
			if (needsFinalUpdate) updates.push(variables);
			const { deployBulkProgressUpdate } = await serverGqlService.request(
				DeployBulkProgressUpdateDocument,
				{ input: updates },
				getAuthorizationHeader(request),
			);
			await sleepForHalfSecond();
			await removeCachedUserCollectionsList(request);
			response.headers = extendResponseHeaders(
				response.headers,
				await createToastHeaders({
					type: !deployBulkProgressUpdate ? "error" : "success",
					message: !deployBulkProgressUpdate
						? "Progress was not updated"
						: "Progress updated successfully",
				}),
			);
			redirectTo = submission[redirectToQueryParam];
		})
		.with("individualProgressUpdate", async () => {
			const submission = processSubmission(formData, bulkUpdateSchema);
			await serverGqlService.request(
				DeployBulkProgressUpdateDocument,
				{ input: submission },
				getAuthorizationHeader(request),
			);
			await sleepForHalfSecond();
			await removeCachedUserCollectionsList(request);
			response.headers = extendResponseHeaders(
				response.headers,
				await createToastHeaders({
					message: "Progress updated successfully",
					type: "success",
				}),
			);
		})
		.with("createMeasurement", async () => {
			// biome-ignore lint/suspicious/noExplicitAny: the form values ensure that the submission is valid
			const input: any = {};
			for (const [name, value] of formData.entries()) {
				if (!isEmpty(value) && name !== redirectToQueryParam)
					set(input, name, value);
			}
			await serverGqlService.request(
				CreateUserMeasurementDocument,
				{ input },
				getAuthorizationHeader(request),
			);
			response.headers = extendResponseHeaders(
				response.headers,
				await createToastHeaders({
					type: "success",
					message: "Measurement submitted successfully",
				}),
			);
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
	const individualIds = convertEntityToIndividualId(
		submission.entityId,
		submission.entityLot,
	);
	return [submission, individualIds] as const;
};

const progressUpdateSchema = z
	.object({
		metadataLot: z.nativeEnum(MediaLot),
		date: z.string().optional(),
		[redirectToQueryParam]: z.string().optional(),
		showSpecifics: z.string().optional(),
		showAllSeasonsBefore: zx.CheckboxAsString.optional(),
		podcastSpecifics: z.string().optional(),
		onlySeason: zx.BoolAsString.optional(),
		completeShow: zx.BoolAsString.optional(),
		completePodcast: zx.BoolAsString.optional(),
		animeAllEpisodesBefore: zx.CheckboxAsString.optional(),
		mangaAllChaptersBefore: zx.CheckboxAsString.optional(),
		providerWatchedOn: z.string().optional(),
	})
	.merge(MetadataIdSchema)
	.merge(MetadataSpecificsSchema);

const showSpecificsSchema = z.array(
	z.object({ seasonNumber: z.number(), episodes: z.array(z.number()) }),
);

const podcastSpecificsSchema = z.array(z.object({ episodeNumber: z.number() }));

const bulkUpdateSchema = z
	.object({
		progress: z.string().optional(),
		date: z.string().optional(),
		changeState: z.nativeEnum(SeenState).optional(),
		providerWatchedOn: z.string().optional(),
	})
	.merge(MetadataSpecificsSchema)
	.merge(MetadataIdSchema);

const sleepForHalfSecond = () =>
	new Promise((resolve) => setTimeout(resolve, 500));
