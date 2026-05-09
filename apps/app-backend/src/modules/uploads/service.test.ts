import { describe, expect, it } from "bun:test";

import {
	createPresignedDownloads,
	createPresignedUpload,
	resolvePresignedUploadInput,
} from "./service";

describe("createPresignedUpload", () => {
	it("rejects unsupported content types", () => {
		expect(() => resolvePresignedUploadInput({ contentType: "application/pdf" })).toThrow(
			"Upload content type must be a supported MIME type",
		);
	});

	it("generates a canonical key when filename is omitted", async () => {
		expect(
			createPresignedUpload(
				{ contentType: "image/png" },
				{
					generateObjectId: () => "image_123",
					signUploadUrl: async ({ key }) => `https://example.com/${key}`,
				},
			),
		).resolves.toEqual({
			key: "uploads/image_123.png",
			uploadUrl: "https://example.com/uploads/image_123.png",
		});
	});

	it("uses mime-based extension for jpeg uploads", async () => {
		expect(
			createPresignedUpload(
				{ contentType: "image/jpeg" },
				{
					generateObjectId: () => "image_456",
					signUploadUrl: async ({ key }) => `https://example.com/${key}`,
				},
			),
		).resolves.toEqual({
			key: "uploads/image_456.jpg",
			uploadUrl: "https://example.com/uploads/image_456.jpg",
		});
	});
});

describe("createPresignedDownloads", () => {
	it("returns presigned URLs for multiple keys", async () => {
		expect(
			createPresignedDownloads(
				{ keys: ["uploads/image_123.png", "uploads/image_456.jpg"] },
				{ signDownloadUrl: async (k: string) => `https://example.com/${k}` },
			),
		).resolves.toEqual([
			{
				key: "uploads/image_123.png",
				downloadUrl: "https://example.com/uploads/image_123.png",
			},
			{
				key: "uploads/image_456.jpg",
				downloadUrl: "https://example.com/uploads/image_456.jpg",
			},
		]);
	});
});
