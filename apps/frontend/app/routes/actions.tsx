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
	CreateOrUpdateReviewDocument,
	CreateReviewCommentDocument,
	CreateUserMeasurementDocument,
	DeleteReviewDocument,
	DeleteS3ObjectDocument,
	DeployBulkProgressUpdateDocument,
	EntityLot,
	MediaLot,
	MediaSource,
	MetadataDetailsDocument,
	RemoveEntityFromCollectionDocument,
	SeenState,
	UserMetadataDetailsDocument,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import {
	isEmpty,
	isNumber,
	omitBy,
	processSubmission,
	set,
} from "@ryot/ts-utils";
import { $path } from "remix-routes";
import { wait } from "remix-utils/timers";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { redirectToQueryParam } from "~/lib/generals";
import {
	MetadataIdSchema,
	MetadataSpecificsSchema,
	colorSchemeCookie,
	createToastHeaders,
	extendResponseHeaders,
	getLogoutCookies,
	removeCachedUserCollectionsList,
	s3FileUploader,
	serverGqlService,
} from "~/lib/utilities.server";

const sleepForHalfSecond = async (request: Request) =>
	await wait(500, { signal: request.signal });

export const loader = async () => redirect($path("/"));

export const action = unstable_defineAction(async ({ request }) => {
	const formData = await request.clone().formData();
	const { searchParams } = new URL(request.url);
	const intent = searchParams.get("intent") as string;
	invariant(intent);
	const redirectToForm = formData.get(redirectToQueryParam);
	let redirectTo = redirectToForm ? redirectToForm.toString() : undefined;
	let returnData = {};
	const headers = new Headers();
	let status = undefined;
	await match(intent)
		.with("commitMedia", async () => {
			const submission = processSubmission(formData, commitMediaSchema);
			const { commitMetadata } = await serverGqlService.authenticatedRequest(
				request,
				CommitMetadataDocument,
				{ input: submission },
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
			const { deleteS3Object } = await serverGqlService.authenticatedRequest(
				request,
				DeleteS3ObjectDocument,
				{ key },
			);
			returnData = { success: deleteS3Object };
		})
		.with("commitPerson", async () => {
			const submission = processSubmission(formData, commitPersonSchema);
			const { commitPerson } = await serverGqlService.authenticatedRequest(
				request,
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
			);
			returnData = { commitPerson };
		})
		.with("commitMetadataGroup", async () => {
			const submission = processSubmission(formData, commitMediaSchema);
			const { commitMetadataGroup } =
				await serverGqlService.authenticatedRequest(
					request,
					CommitMetadataGroupDocument,
					{ input: submission },
				);
			returnData = { commitMetadataGroup };
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
			removeCachedUserCollectionsList(request);
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
			removeCachedUserCollectionsList(request);
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
		.with("progressUpdate", async () => {
			const submission = processSubmission(formData, progressUpdateSchema);
			const metadataId = submission.metadataId;
			const { metadataDetails } = await serverGqlService.request(
				MetadataDetailsDocument,
				{ metadataId },
			);
			const { userMetadataDetails } =
				await serverGqlService.authenticatedRequest(
					request,
					UserMetadataDetailsDocument,
					{ metadataId },
				);
			const latestHistoryItem = userMetadataDetails?.history?.[0];
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
			const updates = [];
			const showSpecifics = metadataDetails.showSpecifics?.seasons || [];
			const podcastSpecifics = metadataDetails.podcastSpecifics?.episodes || [];
			if (
				submission.metadataLot === MediaLot.Anime &&
				submission.animeAllEpisodesBefore &&
				submission.animeEpisodeNumber
			) {
				const lastSeenEpisode =
					latestHistoryItem?.animeExtraInformation?.episode || 0;
				for (
					let i = lastSeenEpisode + 1;
					i < submission.animeEpisodeNumber;
					i++
				) {
					updates.push({ ...variables, animeEpisodeNumber: i });
				}
			}
			if (submission.metadataLot === MediaLot.Manga) {
				const isValidNumber = (value: unknown): boolean => {
					const num = Number(value);
					return !Number.isNaN(num) && Number.isFinite(num);
				};

				if (
					(isValidNumber(submission.mangaChapterNumber) &&
						isNumber(submission.mangaVolumeNumber)) ||
					(!isValidNumber(submission.mangaChapterNumber) &&
						!isNumber(submission.mangaVolumeNumber))
				)
					throw Response.json({
						message:
							"Exactly one of mangaChapterNumber or mangaVolumeNumber must be provided",
					});
				if (submission.mangaAllChaptersOrVolumesBefore) {
					if (submission.mangaVolumeNumber) {
						const lastSeenVolume =
							latestHistoryItem?.mangaExtraInformation?.volume || 0;
						for (
							let i = lastSeenVolume + 1;
							i < submission.mangaVolumeNumber;
							i++
						) {
							updates.push({ ...variables, mangaVolumeNumber: i });
						}
					}
					if (submission.mangaChapterNumber) {
						const targetChapter = Number(submission.mangaChapterNumber);
						const markedChapters = new Set();

						for (const historyItem of userMetadataDetails?.history ?? []) {
							const chapter = Number(
								historyItem?.mangaExtraInformation?.chapter,
							);

							if (!Number.isNaN(chapter) && chapter < targetChapter) {
								markedChapters.add(chapter);
							}
						}

						for (let i = 1; i < targetChapter; i++) {
							if (!markedChapters.has(i)) {
								updates.push({
									...variables,
									mangaChapterNumber: i.toString(),
								});
							}
						}
					}
				}
			}
			if (
				submission.metadataLot === MediaLot.Show &&
				submission.showAllEpisodesBefore
			) {
				const allEpisodesInShow = showSpecifics.flatMap((s) =>
					s.episodes.map((e) => ({ seasonNumber: s.seasonNumber, ...e })),
				);
				const selectedEpisodeIndex = allEpisodesInShow.findIndex(
					(e) =>
						e.seasonNumber === submission.showSeasonNumber &&
						e.episodeNumber === submission.showEpisodeNumber,
				);
				invariant(selectedEpisodeIndex !== -1);
				const firstEpisodeOfShow = allEpisodesInShow[0];
				const lastSeenEpisode = latestHistoryItem?.showExtraInformation || {
					episode: firstEpisodeOfShow.episodeNumber,
					season: firstEpisodeOfShow.seasonNumber,
				};
				const lastSeenEpisodeIndex = allEpisodesInShow.findIndex(
					(e) =>
						e.seasonNumber === lastSeenEpisode.season &&
						e.episodeNumber === lastSeenEpisode.episode,
				);
				invariant(lastSeenEpisodeIndex !== -1);
				const firstEpisodeIndexToMark =
					lastSeenEpisodeIndex + (latestHistoryItem ? 1 : 0);
				if (selectedEpisodeIndex > firstEpisodeIndexToMark) {
					for (let i = firstEpisodeIndexToMark; i < selectedEpisodeIndex; i++) {
						const episode = allEpisodesInShow[i];
						updates.push({
							...variables,
							showSeasonNumber: episode.seasonNumber,
							showEpisodeNumber: episode.episodeNumber,
						});
					}
				}
			}
			if (
				submission.metadataLot === MediaLot.Podcast &&
				submission.podcastAllEpisodesBefore
			) {
				const selectedEpisode = podcastSpecifics.find(
					(e) => e.number === submission.podcastEpisodeNumber,
				);
				invariant(selectedEpisode);
				const lastSeenEpisode =
					latestHistoryItem?.podcastExtraInformation?.episode || 0;
				const allUnseenEpisodesBefore = podcastSpecifics
					.filter(
						(e) =>
							e.number < selectedEpisode.number && e.number > lastSeenEpisode,
					)
					.map((e) => ({ ...variables, podcastEpisodeNumber: e.number }));
				updates.push(...allUnseenEpisodesBefore);
			}
			updates.push(variables);
			const { deployBulkProgressUpdate } =
				await serverGqlService.authenticatedRequest(
					request,
					DeployBulkProgressUpdateDocument,
					{ input: updates },
				);
			await sleepForHalfSecond(request);
			await removeCachedUserCollectionsList(request);
			extendResponseHeaders(
				headers,
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
			await serverGqlService.authenticatedRequest(
				request,
				DeployBulkProgressUpdateDocument,
				{ input: submission },
			);
			await sleepForHalfSecond(request);
			await removeCachedUserCollectionsList(request);
			extendResponseHeaders(
				headers,
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
			await serverGqlService.authenticatedRequest(
				request,
				CreateUserMeasurementDocument,
				{ input },
			);
			extendResponseHeaders(
				headers,
				await createToastHeaders({
					type: "success",
					message: "Measurement submitted successfully",
				}),
			);
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
			await removeCachedUserCollectionsList(request);
		})
		.run();
	if (redirectTo) {
		headers.append("Location", redirectTo.toString());
		status = 302;
	}
	return Response.json(returnData, { headers, status });
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
	entityId: z.string(),
	creatorUserId: z.string(),
	collectionName: z.string(),
	information: z.any().optional(),
	entityLot: z.nativeEnum(EntityLot),
});

const reviewSchema = z
	.object({
		shouldDelete: zx.BoolAsString.optional(),
		rating: z.string().optional(),
		text: z.string().optional(),
		visibility: z.nativeEnum(Visibility).optional(),
		isSpoiler: zx.CheckboxAsString.optional(),
		entityId: z.string().optional(),
		entityLot: z.nativeEnum(EntityLot).optional(),
		reviewId: z.string().optional(),
	})
	.merge(MetadataSpecificsSchema);

const getChangeCollectionToEntityVariables = (formData: FormData) => {
	const submission = processSubmission(
		formData,
		changeCollectionToEntitySchema,
	);
	return [submission] as const;
};

const progressUpdateSchema = z
	.object({
		metadataLot: z.nativeEnum(MediaLot),
		date: z.string().optional(),
		[redirectToQueryParam]: z.string().optional(),
		showAllEpisodesBefore: zx.BoolAsString.optional(),
		podcastAllEpisodesBefore: zx.CheckboxAsString.optional(),
		animeAllEpisodesBefore: zx.CheckboxAsString.optional(),
		mangaAllChaptersOrVolumesBefore: zx.CheckboxAsString.optional(),
		providerWatchedOn: z.string().optional(),
	})
	.merge(MetadataIdSchema)
	.merge(MetadataSpecificsSchema);

const bulkUpdateSchema = z
	.object({
		progress: z.string().optional(),
		date: z.string().optional(),
		changeState: z.nativeEnum(SeenState).optional(),
	})
	.merge(MetadataSpecificsSchema)
	.merge(MetadataIdSchema);

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
