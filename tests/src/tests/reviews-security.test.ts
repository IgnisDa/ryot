import {
	CollectionContentsDocument,
	CreateOrUpdateReviewDocument,
	CreateReviewCommentDocument,
	DeleteReviewDocument,
	EntityLot,
	ExpireCacheKeyDocument,
	Visibility,
} from "@ryot/generated/graphql/backend/graphql";
import {
	getGraphqlClient,
	getUserCollectionsList,
	registerAdminUser,
	registerTestUser,
} from "src/utils";
import { beforeAll, describe, expect, it } from "vitest";

async function createReviewFixture(
	url: string,
	visibility = Visibility.Public,
) {
	const client = getGraphqlClient(url);
	const [ownerApiKey, ownerUserId] = await registerTestUser(url);
	const [otherApiKey, otherUserId] = await registerTestUser(url);
	const ownerCollections = await getUserCollectionsList(url, ownerApiKey);
	const otherCollections = await getUserCollectionsList(url, otherApiKey);
	const ownerCollection = ownerCollections.find(
		(collection) => collection.isDefault,
	);
	const otherCollection = otherCollections.find(
		(collection) => collection.isDefault,
	);
	if (!ownerCollection || !otherCollection) {
		throw new Error("Expected each review user to have a default collection");
	}
	const { createOrUpdateReview } = await client.request(
		CreateOrUpdateReviewDocument,
		{
			input: {
				entityId: ownerCollection.id,
				entityLot: EntityLot.Collection,
				text: "Original review text",
				visibility,
			},
		},
		{ Authorization: `Bearer ${ownerApiKey}` },
	);
	return {
		client,
		ownerApiKey,
		ownerUserId,
		otherApiKey,
		otherUserId,
		ownerCollection,
		otherCollection,
		reviewId: createOrUpdateReview.id,
	};
}

async function getReviews(
	client: ReturnType<typeof getGraphqlClient>,
	collectionId: string,
	apiKey: string,
) {
	const { collectionContents } = await client.request(
		CollectionContentsDocument,
		{ input: { collectionId } },
		{ Authorization: `Bearer ${apiKey}` },
	);
	await client.request(
		ExpireCacheKeyDocument,
		{ cacheId: collectionContents.cacheId },
		{ Authorization: `Bearer ${apiKey}` },
	);
	return collectionContents.response.reviews;
}

describe("Review authorization regressions", () => {
	const url = process.env.API_BASE_URL as string;

	beforeAll(async () => {
		await registerAdminUser(url);
	});

	it("rejects foreign review edits and deletes without changing review content", async () => {
		const fixture = await createReviewFixture(url);
		const ownerHeaders = {
			Authorization: `Bearer ${fixture.ownerApiKey}`,
		};
		const otherHeaders = {
			Authorization: `Bearer ${fixture.otherApiKey}`,
		};
		await fixture.client.request(
			CreateReviewCommentDocument,
			{ input: { reviewId: fixture.reviewId, text: "Owner comment" } },
			ownerHeaders,
		);

		await expect(
			fixture.client.request(
				CreateOrUpdateReviewDocument,
				{
					input: {
						entityId: fixture.ownerCollection.id,
						entityLot: EntityLot.Collection,
						reviewId: fixture.reviewId,
						text: "Hijacked review text",
					},
				},
				otherHeaders,
			),
		).rejects.toThrow("This review does not belong to you");
		await expect(
			fixture.client.request(
				DeleteReviewDocument,
				{ reviewId: fixture.reviewId },
				otherHeaders,
			),
		).rejects.toThrow("This review does not belong to you");

		const reviews = await getReviews(
			fixture.client,
			fixture.ownerCollection.id,
			fixture.ownerApiKey,
		);
		expect(reviews).toHaveLength(1);
		expect(reviews[0]).toMatchObject({
			id: fixture.reviewId,
			textOriginal: "Original review text",
			postedBy: { id: fixture.ownerUserId },
			comments: [
				{
					text: "Owner comment",
					user: { id: fixture.ownerUserId },
				},
			],
		});
	});

	it("allows owner edits, preserves comments, and rejects entity changes", async () => {
		const fixture = await createReviewFixture(url);
		const ownerHeaders = {
			Authorization: `Bearer ${fixture.ownerApiKey}`,
		};
		await fixture.client.request(
			CreateReviewCommentDocument,
			{ input: { reviewId: fixture.reviewId, text: "Keep this comment" } },
			ownerHeaders,
		);

		await expect(
			fixture.client.request(
				CreateOrUpdateReviewDocument,
				{
					input: {
						entityId: fixture.otherCollection.id,
						entityLot: EntityLot.Collection,
						reviewId: fixture.reviewId,
						text: "Moved review",
					},
				},
				ownerHeaders,
			),
		).rejects.toThrow("Review entity does not match the existing review");
		const { createOrUpdateReview } = await fixture.client.request(
			CreateOrUpdateReviewDocument,
			{
				input: {
					entityId: fixture.ownerCollection.id,
					entityLot: EntityLot.Collection,
					reviewId: fixture.reviewId,
					text: "Updated review text",
				},
			},
			ownerHeaders,
		);
		expect(createOrUpdateReview.id).toBe(fixture.reviewId);

		const reviews = await getReviews(
			fixture.client,
			fixture.ownerCollection.id,
			fixture.ownerApiKey,
		);
		expect(reviews).toHaveLength(1);
		expect(reviews[0]).toMatchObject({
			id: fixture.reviewId,
			textOriginal: "Updated review text",
			postedBy: { id: fixture.ownerUserId },
			comments: [
				{
					text: "Keep this comment",
					user: { id: fixture.ownerUserId },
				},
			],
		});
	});

	it("allows only the comment author to delete a comment", async () => {
		const fixture = await createReviewFixture(url);
		const input = { reviewId: fixture.reviewId, text: "Author-owned comment" };
		await fixture.client.request(
			CreateReviewCommentDocument,
			{ input },
			{ Authorization: `Bearer ${fixture.ownerApiKey}` },
		);
		const reviewsBeforeDelete = await getReviews(
			fixture.client,
			fixture.ownerCollection.id,
			fixture.ownerApiKey,
		);
		const commentId = reviewsBeforeDelete[0]?.comments[0]?.id;
		expect(commentId).toBeTruthy();
		if (!commentId) throw new Error("Expected owner comment ID");

		await expect(
			fixture.client.request(
				CreateReviewCommentDocument,
				{
					input: { reviewId: fixture.reviewId, commentId, shouldDelete: true },
				},
				{ Authorization: `Bearer ${fixture.otherApiKey}` },
			),
		).rejects.toThrow("Only the comment author can delete it");
		const reviewsAfterDeniedDelete = await getReviews(
			fixture.client,
			fixture.ownerCollection.id,
			fixture.ownerApiKey,
		);
		expect(reviewsAfterDeniedDelete[0].comments).toHaveLength(1);

		const { createReviewComment } = await fixture.client.request(
			CreateReviewCommentDocument,
			{
				input: { reviewId: fixture.reviewId, commentId, shouldDelete: true },
			},
			{ Authorization: `Bearer ${fixture.ownerApiKey}` },
		);
		expect(createReviewComment).toBe(true);
		const reviewsAfterOwnDelete = await getReviews(
			fixture.client,
			fixture.ownerCollection.id,
			fixture.ownerApiKey,
		);
		expect(reviewsAfterOwnDelete[0].comments).toHaveLength(0);
	});

	it("denies comment interactions on private reviews to other users", async () => {
		const fixture = await createReviewFixture(url, Visibility.Private);
		const ownerHeaders = {
			Authorization: `Bearer ${fixture.ownerApiKey}`,
		};
		const otherHeaders = {
			Authorization: `Bearer ${fixture.otherApiKey}`,
		};
		await fixture.client.request(
			CreateReviewCommentDocument,
			{ input: { reviewId: fixture.reviewId, text: "Private owner comment" } },
			ownerHeaders,
		);
		const reviews = await getReviews(
			fixture.client,
			fixture.ownerCollection.id,
			fixture.ownerApiKey,
		);
		const commentId = reviews[0]?.comments[0]?.id;
		expect(commentId).toBeTruthy();
		if (!commentId) throw new Error("Expected private review comment ID");

		for (const input of [
			{ reviewId: fixture.reviewId, text: "Foreign private comment" },
			{ reviewId: fixture.reviewId, commentId, incrementLikes: true },
			{ reviewId: fixture.reviewId, commentId, shouldDelete: true },
		]) {
			await expect(
				fixture.client.request(
					CreateReviewCommentDocument,
					{ input },
					otherHeaders,
				),
			).rejects.toThrow("You cannot interact with this review");
		}

		const reviewsAfterDeniedActions = await getReviews(
			fixture.client,
			fixture.ownerCollection.id,
			fixture.ownerApiKey,
		);
		expect(reviewsAfterDeniedActions[0]).toMatchObject({
			visibility: Visibility.Private,
			comments: [
				{
					id: commentId,
					text: "Private owner comment",
					likedBy: [],
				},
			],
		});
	});

	it("returns controlled errors for invalid comment action inputs", async () => {
		const fixture = await createReviewFixture(url);
		const ownerHeaders = {
			Authorization: `Bearer ${fixture.ownerApiKey}`,
		};
		const missingReviewId = "review-does-not-exist";
		await expect(
			fixture.client.request(
				CreateReviewCommentDocument,
				{ input: { reviewId: missingReviewId, text: "Orphan comment" } },
				ownerHeaders,
			),
		).rejects.toThrow("Review not found");
		await expect(
			fixture.client.request(
				CreateOrUpdateReviewDocument,
				{
					input: {
						entityId: fixture.ownerCollection.id,
						entityLot: EntityLot.Collection,
						reviewId: missingReviewId,
						text: "Missing review update",
					},
				},
				ownerHeaders,
			),
		).rejects.toThrow("Review not found");
		const { deleteReview } = await fixture.client.request(
			DeleteReviewDocument,
			{ reviewId: missingReviewId },
			ownerHeaders,
		);
		expect(deleteReview).toBe(false);

		await expect(
			fixture.client.request(
				CreateReviewCommentDocument,
				{ input: { reviewId: fixture.reviewId } },
				ownerHeaders,
			),
		).rejects.toThrow("Comment text is required");
		await expect(
			fixture.client.request(
				CreateReviewCommentDocument,
				{ input: { reviewId: fixture.reviewId, text: "" } },
				ownerHeaders,
			),
		).rejects.toThrow("Comment text is required");
		await expect(
			fixture.client.request(
				CreateReviewCommentDocument,
				{ input: { reviewId: fixture.reviewId, shouldDelete: true } },
				ownerHeaders,
			),
		).rejects.toThrow("Comment ID is required");
		await expect(
			fixture.client.request(
				CreateReviewCommentDocument,
				{
					input: {
						reviewId: fixture.reviewId,
						commentId: "comment-does-not-exist",
						incrementLikes: true,
					},
				},
				ownerHeaders,
			),
		).rejects.toThrow("Comment not found");

		await fixture.client.request(
			CreateReviewCommentDocument,
			{ input: { reviewId: fixture.reviewId, text: "Existing comment" } },
			ownerHeaders,
		);
		const reviewsBeforeConflict = await getReviews(
			fixture.client,
			fixture.ownerCollection.id,
			fixture.ownerApiKey,
		);
		const commentId = reviewsBeforeConflict[0]?.comments[0]?.id;
		expect(commentId).toBeTruthy();
		if (!commentId) throw new Error("Expected existing comment ID");
		await expect(
			fixture.client.request(
				CreateReviewCommentDocument,
				{
					input: {
						reviewId: fixture.reviewId,
						commentId,
						shouldDelete: true,
						incrementLikes: true,
					},
				},
				ownerHeaders,
			),
		).rejects.toThrow("Only one comment action can be requested at a time");
		const reviewsAfterConflict = await getReviews(
			fixture.client,
			fixture.ownerCollection.id,
			fixture.ownerApiKey,
		);
		expect(reviewsAfterConflict[0].comments).toHaveLength(1);
		expect(reviewsAfterConflict[0].comments[0]).toMatchObject({
			id: commentId,
			text: "Existing comment",
			likedBy: [],
		});
	});
});
