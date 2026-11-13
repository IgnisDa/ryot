import { randomUUID } from "node:crypto";
import {
	CreateCustomExerciseDocument,
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

	const uploadAsset = async () => {
		const { presignedPutS3Url } = await client.request(
			PresignedPutS3UrlDocument,
			{ prefix: "exercise-security" },
			headers(ownerKey),
		);
		const response = await fetch(presignedPutS3Url.uploadUrl, {
			method: "PUT",
			body: "Exercise asset contents",
		});
		expect(response.ok).toBe(true);
		return presignedPutS3Url.key;
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
