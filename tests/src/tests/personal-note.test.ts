import {
	CreateCustomMetadataDocument,
	DeletePersonalNoteDocument,
	MediaLot,
	PersonalNoteDocument,
	SetPersonalNoteDocument,
	UserMetadataDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	getGraphqlClient,
	registerAdminUser,
	registerTestUser,
} from "src/utils";
import { beforeAll, describe, expect, it } from "vitest";

describe("Private personal notes", () => {
	const url = process.env.API_BASE_URL as string;
	const client = getGraphqlClient(url);
	let owner: { Authorization: string };
	let other: { Authorization: string };
	let metadataId: string;
	beforeAll(async () => {
		await registerAdminUser(url);
		const [ownerKey] = await registerTestUser(url);
		const [otherKey] = await registerTestUser(url);
		owner = { Authorization: `Bearer ${ownerKey}` };
		other = { Authorization: `Bearer ${otherKey}` };
		const result = await client.request(
			CreateCustomMetadataDocument,
			{
				input: {
					lot: MediaLot.Book,
					title: "Personal note isolation fixture",
					assets: {
						s3Images: [],
						s3Videos: [],
						remoteImages: [],
						remoteVideos: [],
					},
				},
			},
			owner,
		);
		metadataId = result.createCustomMetadata.id;
	});

	it("creates, updates and deletes one note per authenticated user and item", async () => {
		const input = { metadataId };
		expect(
			(await client.request(PersonalNoteDocument, input, owner)).personalNote,
		).toBeNull();
		const before = (
			await client.request(UserMetadataDetailsDocument, input, owner)
		).userMetadataDetails.response;
		const created = (
			await client.request(
				SetPersonalNoteDocument,
				{ ...input, text: "Recommended by a friend" },
				owner,
			)
		).setPersonalNote;
		expect(created.text).toBe("Recommended by a friend");
		expect(
			(await client.request(PersonalNoteDocument, input, other)).personalNote,
		).toBeNull();
		const updated = (
			await client.request(
				SetPersonalNoteDocument,
				{ ...input, text: "  Моя личная заметка 🎮  " },
				owner,
			)
		).setPersonalNote;
		expect(updated.createdAt).toBe(created.createdAt);
		expect(updated.text).toBe("  Моя личная заметка 🎮  ");
		const after = (
			await client.request(UserMetadataDetailsDocument, input, owner)
		).userMetadataDetails.response;
		expect(after.reviews).toEqual(before.reviews);
		expect(after.averageRating).toBe(before.averageRating);
		expect(
			await client.request(DeletePersonalNoteDocument, input, other),
		).toEqual({ deletePersonalNote: false });
		await client.request(
			SetPersonalNoteDocument,
			{ ...input, text: "Another user's note" },
			other,
		);
		expect(
			(await client.request(PersonalNoteDocument, input, owner)).personalNote
				?.text,
		).toBe(updated.text);
		await client.request(DeletePersonalNoteDocument, input, other);
		expect(
			(await client.request(PersonalNoteDocument, input, owner)).personalNote
				?.text,
		).toBe(updated.text);
		expect(
			await client.request(DeletePersonalNoteDocument, input, owner),
		).toEqual({ deletePersonalNote: true });
		expect(
			(await client.request(PersonalNoteDocument, input, owner)).personalNote,
		).toBeNull();
	});

	it("requires authentication for reading, writing and deleting", async () => {
		await expect(
			client.request(PersonalNoteDocument, { metadataId }),
		).rejects.toThrow();
		await expect(
			client.request(SetPersonalNoteDocument, { metadataId, text: "Private" }),
		).rejects.toThrow();
		await expect(
			client.request(DeletePersonalNoteDocument, { metadataId }),
		).rejects.toThrow();
	});

	it("rejects blank and oversized notes without saving them", async () => {
		for (const text of ["  \n ", "🎮".repeat(16001)]) {
			await expect(
				client.request(SetPersonalNoteDocument, { metadataId, text }, owner),
			).rejects.toThrow();
		}
		expect(
			(await client.request(PersonalNoteDocument, { metadataId }, owner))
				.personalNote,
		).toBeNull();
	});
	it("counts Unicode characters and rejects nonexistent media", async () => {
		const text = "🎮".repeat(16000);
		expect(
			(
				await client.request(
					SetPersonalNoteDocument,
					{ metadataId, text },
					owner,
				)
			).setPersonalNote.text,
		).toBe(text);
		await client.request(DeletePersonalNoteDocument, { metadataId }, owner);
		await expect(
			client.request(
				SetPersonalNoteDocument,
				{ metadataId: "nonexistent-note-fixture", text: "No orphan note" },
				owner,
			),
		).rejects.toThrow();
	});
});
