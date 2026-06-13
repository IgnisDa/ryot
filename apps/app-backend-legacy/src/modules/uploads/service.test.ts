import { describe, expect, it } from "bun:test";

import { getTemporaryDirectory } from "~/lib/bun";

import {
	createPresignedDownloads,
	createPresignedUpload,
	createTemporaryUploads,
	resolvePresignedUploadInput,
} from "./service";

const temporaryDirectory = getTemporaryDirectory();

describe("createPresignedUpload", () => {
	it("rejects unsupported content types", () => {
		expect(() => resolvePresignedUploadInput({ contentType: "application/pdf" })).toThrow(
			"Upload content type must be a supported MIME type",
		);
	});

	it("generates a canonical key when filename is omitted", () => {
		return expect(
			createPresignedUpload(
				{ contentType: "image/png" },
				{
					generateObjectId: () => "image_123",
					signUploadUrl: ({ key }) => Promise.resolve({ data: `https://example.com/${key}` }),
				},
			),
		).resolves.toEqual({
			data: {
				key: "uploads/image_123.png",
				uploadUrl: "https://example.com/uploads/image_123.png",
			},
		});
	});

	it("uses mime-based extension for jpeg uploads", () => {
		return expect(
			createPresignedUpload(
				{ contentType: "image/jpeg" },
				{
					generateObjectId: () => "image_456",
					signUploadUrl: ({ key }) => Promise.resolve({ data: `https://example.com/${key}` }),
				},
			),
		).resolves.toEqual({
			data: {
				key: "uploads/image_456.jpg",
				uploadUrl: "https://example.com/uploads/image_456.jpg",
			},
		});
	});

	it("uses mime-based extensions for csv, zip, and json uploads", async () => {
		const cases = [
			["text/csv", "csv"],
			["application/zip", "zip"],
			["application/json", "json"],
		] as const;

		await Promise.all(
			cases.map(async ([contentType, extension]) => {
				const result = await createPresignedUpload(
					{ contentType },
					{
						generateObjectId: () => `file_${extension}`,
						signUploadUrl: ({ key }) => Promise.resolve({ data: `https://example.com/${key}` }),
					},
				);

				expect(result).toEqual({
					data: {
						key: `uploads/file_${extension}.${extension}`,
						uploadUrl: `https://example.com/uploads/file_${extension}.${extension}`,
					},
				});
			}),
		);
	});
});

const fakeStoreToken = (_userId: string, path: string) =>
	Promise.resolve(`token-${path.split("/").pop()}`);

describe("createTemporaryUploads", () => {
	it("writes supported files to the temporary directory and returns tokens", async () => {
		let sequence = 0;
		const writes: Array<{ content: string; path: string }> = [];
		const result = await createTemporaryUploads(
			{
				userId: "user_1",
				files: [
					new File(["csv data"], "report.csv", { type: "text/csv" }),
					new File(["zip data"], "archive.zip", { type: "application/zip" }),
					new File(["xml data"], "anime.xml", { type: "application/xml" }),
					new File(["gz data"], "anime.xml.gz", { type: "application/gzip" }),
					new File(["json data"], "payload.json", { type: "application/json" }),
				],
			},
			{
				generateObjectId: () => `temp_${++sequence}`,
				temporaryDirectory: "/tmp/ryot-uploads",
				storeToken: fakeStoreToken,
				writeFile: async (path, file) => {
					writes.push({ content: await file.text(), path });
				},
			},
		);

		expect(result).toEqual({
			data: [
				"token-temp_1-report.csv",
				"token-temp_2-archive.zip",
				"token-temp_3-anime.xml",
				"token-temp_4-anime.xml.gz",
				"token-temp_5-payload.json",
			],
		});
		expect(writes).toEqual([
			{ content: "csv data", path: "/tmp/ryot-uploads/temp_1-report.csv" },
			{ content: "zip data", path: "/tmp/ryot-uploads/temp_2-archive.zip" },
			{ content: "xml data", path: "/tmp/ryot-uploads/temp_3-anime.xml" },
			{ content: "gz data", path: "/tmp/ryot-uploads/temp_4-anime.xml.gz" },
			{ content: "json data", path: "/tmp/ryot-uploads/temp_5-payload.json" },
		]);
	});

	it("strips trailing separators from file names", async () => {
		const result = await createTemporaryUploads(
			{
				userId: "user_1",
				files: [new File(["csv data"], "folder/report.csv/", { type: "text/csv" })],
			},
			{
				generateObjectId: () => "temp_1",
				storeToken: fakeStoreToken,
				writeFile: () => Promise.resolve(),
				temporaryDirectory: "/tmp/ryot-uploads",
			},
		);

		expect(result).toEqual({ data: ["token-temp_1-report.csv"] });
	});

	it("cleans up successful writes when a later file fails", async () => {
		const runId = crypto.randomUUID();
		let sequence = 0;

		const result = await createTemporaryUploads(
			{
				userId: "user_1",
				files: [
					new File(["csv data"], "report.csv", { type: "text/csv" }),
					new File(["json data"], "payload.json", { type: "application/json" }),
				],
			},
			{
				temporaryDirectory,
				storeToken: fakeStoreToken,
				generateObjectId: () => `${runId}_${++sequence}`,
				writeFile: async (path, file) => {
					if (file.name === "report.csv") {
						await Bun.write(path, file);
						return;
					}

					throw new Error("write failed");
				},
			},
		);

		expect(result).toEqual({ error: "internal", message: "write failed" });
		expect(await Bun.file(`${temporaryDirectory}/${runId}_1-report.csv`).exists()).toBe(false);
	});

	it("cleans up written files when token storage fails", async () => {
		const runId = crypto.randomUUID();

		const result = await createTemporaryUploads(
			{
				userId: "user_1",
				files: [new File(["csv data"], "report.csv", { type: "text/csv" })],
			},
			{
				temporaryDirectory,
				generateObjectId: () => `${runId}_1`,
				storeToken: () => Promise.reject(new Error("redis down")),
				writeFile: (path, file) => Bun.write(path, file),
			},
		);

		expect(result).toEqual({
			error: "internal",
			message: "Could not register temporary upload tokens",
		});
		expect(await Bun.file(`${temporaryDirectory}/${runId}_1-report.csv`).exists()).toBe(false);
	});

	it("rejects unsupported temporary upload file types", async () => {
		let wrote = false;
		const result = await createTemporaryUploads(
			{
				userId: "user_1",
				files: [new File(["pdf data"], "document.pdf", { type: "application/pdf" })],
			},
			{
				temporaryDirectory: "/tmp/ryot-uploads",
				storeToken: fakeStoreToken,
				writeFile: () => {
					wrote = true;
					return Promise.resolve();
				},
			},
		);

		expect(result).toEqual({
			error: "validation",
			message: "Upload content type must be a supported MIME type",
		});
		expect(wrote).toBe(false);
	});

	it("rejects temporary upload files that exceed the size limit", async () => {
		let wrote = false;
		const result = await createTemporaryUploads(
			{
				userId: "user_1",
				files: [new File(["123456"], "report.csv", { type: "text/csv" })],
			},
			{
				maxFileBytes: 5,
				temporaryDirectory: "/tmp/ryot-uploads",
				storeToken: fakeStoreToken,
				writeFile: () => {
					wrote = true;
					return Promise.resolve();
				},
			},
		);

		expect(result).toEqual({
			error: "validation",
			message: "Upload file exceeds maximum allowed size of 5 bytes (file is 6 bytes)",
		});
		expect(wrote).toBe(false);
	});

	it("rejects empty temporary upload requests", async () => {
		const result = await createTemporaryUploads({ userId: "user_1", files: [] }, {});

		expect(result).toEqual({
			error: "validation",
			message: "At least one upload file is required",
		});
	});
});

describe("createPresignedDownloads", () => {
	it("returns presigned URLs for multiple keys", () => {
		return expect(
			createPresignedDownloads(
				{ keys: ["uploads/image_123.png", "uploads/image_456.jpg"] },
				{ signDownloadUrl: (k: string) => Promise.resolve({ data: `https://example.com/${k}` }) },
			),
		).resolves.toEqual({
			data: [
				{ key: "uploads/image_123.png", downloadUrl: "https://example.com/uploads/image_123.png" },
				{ key: "uploads/image_456.jpg", downloadUrl: "https://example.com/uploads/image_456.jpg" },
			],
		});
	});
});
