import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
	CreateCustomExerciseDocument,
	DeleteS3ObjectDocument,
	ExerciseDetailsDocument,
	type ExerciseInput,
	ExerciseLevel,
	ExerciseLot,
	ExerciseSource,
	GetPresignedS3UrlDocument,
	PresignedPutS3UrlDocument,
	UpdateCustomExerciseDocument,
	UserExercisesListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { executeTestDatabaseSql } from "src/setup/security-database";
import {
	getGraphqlClient,
	registerAdminUser,
	registerTestUser,
} from "src/utils";
import { beforeAll, describe, expect, it } from "vitest";

function exerciseInput(id: string = randomUUID()): ExerciseInput {
	return {
		id,
		name: id,
		muscles: [],
		level: ExerciseLevel.Beginner,
		lot: ExerciseLot.RepsAndWeight,
		source: ExerciseSource.Custom,
		instructions: ["Original instructions"],
		assets: { s3Images: [], s3Videos: [], remoteImages: [], remoteVideos: [] },
	};
}

describe("Custom exercise authorization regressions", () => {
	const url = process.env.API_BASE_URL as string;
	const client = getGraphqlClient(url);
	const headers = (key: string) => ({ Authorization: `Bearer ${key}` });
	let ownerKey: string;
	let ownerId: string;
	let attackerKey: string;

	const getExercise = async (exerciseId: string) => {
		const { exerciseDetails } = await client.request(
			ExerciseDetailsDocument,
			{ exerciseId },
			headers(ownerKey),
		);
		return exerciseDetails;
	};

	const uploadAsset = async (
		apiKey = ownerKey,
		prefix = "exercise-security",
	) => {
		const { presignedPutS3Url } = await client.request(
			PresignedPutS3UrlDocument,
			{ prefix },
			headers(apiKey),
		);
		const response = await fetch(presignedPutS3Url.uploadUrl, {
			method: "PUT",
			body: "Exercise asset contents",
		});
		expect(response.ok).toBe(true);
		return presignedPutS3Url.key;
	};

	const uploadLegacyAsset = async () => {
		const key = `uploads/exercises/${randomUUID()}`;
		const { presignedPutS3Url } = await client.request(
			PresignedPutS3UrlDocument,
			{ prefix: "exercise-security" },
			headers(ownerKey),
		);
		const storage = new S3Client({
			region: "us-east-1",
			forcePathStyle: true,
			endpoint: new URL(presignedPutS3Url.uploadUrl).origin,
			credentials: {
				accessKeyId: "rustfs-admin",
				secretAccessKey: "rustfs-admin",
			},
		});
		try {
			await storage.send(
				new PutObjectCommand({
					Key: key,
					Bucket: "test-bucket",
					Body: "Exercise asset contents",
				}),
			);
		} finally {
			storage.destroy();
		}
		return key;
	};

	const seedStoredAssets = (
		exerciseId: string,
		assets: ExerciseInput["assets"],
	) => {
		const storedAssets = {
			s3_images: assets.s3Images,
			s3_videos: assets.s3Videos,
			remote_images: assets.remoteImages,
			remote_videos: assets.remoteVideos,
		};
		executeTestDatabaseSql(
			`UPDATE exercise SET assets = '${JSON.stringify(storedAssets).replaceAll("'", "''")}' WHERE id = '${exerciseId.replaceAll("'", "''")}'`,
		);
	};

	const expectAssetIntact = async (key: string) => {
		const { getPresignedS3Url } = await client.request(
			GetPresignedS3UrlDocument,
			{ key },
			headers(ownerKey),
		);
		const response = await fetch(getPresignedS3Url);
		expect(response.ok).toBe(true);
		expect(await response.text()).toBe("Exercise asset contents");
	};

	const expectAssetMissing = async (key: string) => {
		const { getPresignedS3Url } = await client.request(
			GetPresignedS3UrlDocument,
			{ key },
			headers(ownerKey),
		);
		const response = await fetch(getPresignedS3Url);
		expect(response.status).toBe(404);
		await response.body?.cancel();
	};

	beforeAll(async () => {
		await registerAdminUser(url);
		[ownerKey, ownerId] = await registerTestUser(url);
		[attackerKey] = await registerTestUser(url);
	});

	it.each([
		"catalog",
		"foreign custom",
		"ownerless custom",
	])("rejects edits and deletions of a %s exercise before changing data or assets", async (kind) => {
		const image = await uploadAsset();
		const video = await uploadAsset();
		const input = exerciseInput();
		input.assets.s3Images = [image];
		input.assets.s3Videos = [video];
		const { createCustomExercise: exerciseId } = await client.request(
			CreateCustomExerciseDocument,
			{ input },
			headers(ownerKey),
		);
		if (kind !== "foreign custom") {
			const source = kind === "catalog" ? "github" : "custom";
			executeTestDatabaseSql(
				`UPDATE exercise SET source = '${source}', created_by_user_id = NULL WHERE id = '${exerciseId.replaceAll("'", "''")}'`,
			);
		}
		const original = await getExercise(exerciseId);
		const expectedError =
			kind === "catalog"
				? "This exercise is not custom and cannot be updated"
				: "You are not authorized to update this exercise";

		for (const shouldDelete of [false, true]) {
			await expect(
				client.request(
					UpdateCustomExerciseDocument,
					{
						input: {
							...exerciseInput(exerciseId),
							shouldDelete,
							instructions: ["Attacker instructions"],
							name: "Attacker-controlled exercise",
						},
					},
					headers(attackerKey),
				),
			).rejects.toThrow(expectedError);
			expect(await getExercise(exerciseId)).toEqual(original);
			await expectAssetIntact(image);
			await expectAssetIntact(video);
		}

		if (kind !== "ownerless custom") {
			const { userExercisesList } = await client.request(
				UserExercisesListDocument,
				{ input: { search: { query: original.name } } },
				headers(ownerKey),
			);
			expect(userExercisesList.response.items).toContain(exerciseId);
		}
	});

	it("allows owner edits and deletion while preserving server-controlled ownership and source", async () => {
		const input = exerciseInput();
		const { createCustomExercise: exerciseId } = await client.request(
			CreateCustomExerciseDocument,
			{ input },
			headers(ownerKey),
		);
		const update = {
			...input,
			id: exerciseId,
			name: "Owner edited exercise",
			source: ExerciseSource.Github,
			instructions: ["Updated instructions"],
		};
		const { updateCustomExercise } = await client.request(
			UpdateCustomExerciseDocument,
			{ input: update },
			headers(ownerKey),
		);
		expect(updateCustomExercise).toBe(true);
		expect(await getExercise(exerciseId)).toMatchObject({
			id: exerciseId,
			name: update.name,
			createdByUserId: ownerId,
			source: ExerciseSource.Custom,
			instructions: update.instructions,
		});

		const result = await client.request(
			UpdateCustomExerciseDocument,
			{ input: { ...update, shouldDelete: true } },
			headers(ownerKey),
		);
		expect(result.updateCustomExercise).toBe(true);
		await expect(getExercise(exerciseId)).rejects.toThrow(
			"Exercise with the given ID could not be found.",
		);
	});

	it.each([
		"s3Images",
		"s3Videos",
	] as const)("rejects a foreign %s key on both creation and update, preventing attach-then-remove deletion", async (field) => {
		const key = await uploadAsset();
		const input = exerciseInput();
		input.assets[field] = [key];
		await expect(
			client.request(
				CreateCustomExerciseDocument,
				{ input },
				headers(attackerKey),
			),
		).rejects.toThrow("You are not authorized to use this file");
		const cleanInput = exerciseInput();
		const { createCustomExercise: exerciseId } = await client.request(
			CreateCustomExerciseDocument,
			{ input: cleanInput },
			headers(attackerKey),
		);
		const original = await getExercise(exerciseId);
		await expect(
			client.request(
				UpdateCustomExerciseDocument,
				{ input: { ...input, id: exerciseId } },
				headers(attackerKey),
			),
		).rejects.toThrow("You are not authorized to use this file");
		expect(await getExercise(exerciseId)).toEqual(original);
		await client.request(
			UpdateCustomExerciseDocument,
			{ input: { ...cleanInput, id: exerciseId } },
			headers(attackerKey),
		);
		await expectAssetIntact(key);
	});

	it.each([
		false,
		true,
	])("independently protects foreign files already referenced by an owned exercise (shouldDelete: %s)", async (shouldDelete) => {
		const image = await uploadAsset();
		const video = await uploadAsset();
		const input = exerciseInput();
		const { createCustomExercise: exerciseId } = await client.request(
			CreateCustomExerciseDocument,
			{ input },
			headers(attackerKey),
		);
		seedStoredAssets(exerciseId, {
			...input.assets,
			s3Images: [image],
			s3Videos: [video],
		});
		const { updateCustomExercise } = await client.request(
			UpdateCustomExerciseDocument,
			{ input: { ...input, shouldDelete, id: exerciseId } },
			headers(attackerKey),
		);
		expect(updateCustomExercise).toBe(true);
		await expectAssetIntact(image);
		await expectAssetIntact(video);
	});

	it("restricts direct file deletion to the uploader", async () => {
		const key = await uploadAsset();
		const denied = await client.request(
			DeleteS3ObjectDocument,
			{ key },
			headers(attackerKey),
		);
		expect(denied.deleteS3Object).toBe(false);
		await expectAssetIntact(key);
		const allowed = await client.request(
			DeleteS3ObjectDocument,
			{ key },
			headers(ownerKey),
		);
		expect(allowed.deleteS3Object).toBe(true);
		await expectAssetMissing(key);
	});

	it.each([
		"../victim",
		"a/../../victim",
		"%2e%2e/victim",
		"a\\..\\victim",
	])("rejects noncanonical upload prefixes (%s)", async (prefix) => {
		await expect(
			client.request(
				PresignedPutS3UrlDocument,
				{ prefix },
				headers(attackerKey),
			),
		).rejects.toThrow("Invalid upload prefix");
	});

	it("keeps a client-supplied user prefix inside the uploader's namespace", async () => {
		const key = await uploadAsset(attackerKey, `users/${ownerId}`);
		expect(key.startsWith(`uploads/users/${ownerId}/`)).toBe(false);
		await expectAssetIntact(key);
		const result = await client.request(
			DeleteS3ObjectDocument,
			{ key },
			headers(attackerKey),
		);
		expect(result.deleteS3Object).toBe(true);
	});

	it("allows the owner to attach and remove their uploaded files", async () => {
		const image = await uploadAsset();
		const video = await uploadAsset();
		const input = exerciseInput();
		input.assets.s3Images = [image];
		input.assets.s3Videos = [video];
		const { createCustomExercise: exerciseId } = await client.request(
			CreateCustomExerciseDocument,
			{ input },
			headers(ownerKey),
		);
		const { updateCustomExercise } = await client.request(
			UpdateCustomExerciseDocument,
			{ input: exerciseInput(exerciseId) },
			headers(ownerKey),
		);
		expect(updateCustomExercise).toBe(true);
		await expectAssetMissing(image);
		await expectAssetMissing(video);
	});

	it("preserves existing legacy attachments and retains their files when removed", async () => {
		const key = await uploadLegacyAsset();
		const input = exerciseInput();
		const { createCustomExercise: exerciseId } = await client.request(
			CreateCustomExerciseDocument,
			{ input },
			headers(ownerKey),
		);
		input.assets.s3Images = [key];
		seedStoredAssets(exerciseId, input.assets);
		await client.request(
			UpdateCustomExerciseDocument,
			{ input: { ...input, id: exerciseId, name: "Edited legacy exercise" } },
			headers(ownerKey),
		);
		expect((await getExercise(exerciseId)).assets.s3Images).toEqual([key]);
		await expect(
			client.request(
				CreateCustomExerciseDocument,
				{ input },
				headers(attackerKey),
			),
		).rejects.toThrow("You are not authorized to use this file");
		await client.request(
			UpdateCustomExerciseDocument,
			{ input: exerciseInput(exerciseId) },
			headers(ownerKey),
		);
		expect((await getExercise(exerciseId)).assets.s3Images).toEqual([]);
		const denied = await client.request(
			DeleteS3ObjectDocument,
			{ key },
			headers(ownerKey),
		);
		expect(denied.deleteS3Object).toBe(false);
		await expectAssetIntact(key);
	});

	it.each([
		false,
		true,
	])("returns a controlled error for a missing exercise (shouldDelete: %s)", async (shouldDelete) => {
		await expect(
			client.request(
				UpdateCustomExerciseDocument,
				{ input: { ...exerciseInput(), shouldDelete } },
				headers(ownerKey),
			),
		).rejects.toThrow("Exercise does not exist");
	});
});
