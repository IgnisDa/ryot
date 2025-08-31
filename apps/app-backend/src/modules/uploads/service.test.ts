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

describe("createTemporaryUploads", () => {
	it("writes supported files to the temporary directory", async () => {
		let sequence = 0;
		const writes: Array<{ content: string; path: string }> = [];
		const result = await createTemporaryUploads(
			{
				files: [
					new File(["csv data"], "report.csv", { type: "text/csv" }),
					new File(["zip data"], "archive.zip", { type: "application/zip" }),
					new File(["json data"], "payload.json", { type: "application/json" }),
				],
			},
			{
				generateObjectId: () => `temp_${++sequence}`,
				temporaryDirectory: "/tmp/ryot-uploads",
				writeFile: async (path, file) => {
					writes.push({ content: await file.text(), path });
				},
			},
		);

		expect(result).toEqual({
			data: [
				"/tmp/ryot-uploads/temp_1-report.csv",
				"/tmp/ryot-uploads/temp_2-archive.zip",
				"/tmp/ryot-uploads/temp_3-payload.json",
			],
		});
		expect(writes).toEqual([
			{ content: "csv data", path: "/tmp/ryot-uploads/temp_1-report.csv" },
			{ content: "zip data", path: "/tmp/ryot-uploads/temp_2-archive.zip" },
			{ content: "json data", path: "/tmp/ryot-uploads/temp_3-payload.json" },
		]);
	});

	it("strips trailing separators from file names", async () => {
		const result = await createTemporaryUploads(
			{ files: [new File(["csv data"], "folder/report.csv/", { type: "text/csv" })] },
			{
				generateObjectId: () => "temp_1",
				writeFile: () => Promise.resolve(),
				temporaryDirectory: "/tmp/ryot-uploads",
			},
		);

		expect(result).toEqual({ data: ["/tmp/ryot-uploads/temp_1-report.csv"] });
	});

	it("cleans up successful writes when a later file fails", async () => {
		const runId = crypto.randomUUID();
		let sequence = 0;

		const result = await createTemporaryUploads(
			{
				files: [
					new File(["csv data"], "report.csv", { type: "text/csv" }),
					new File(["json data"], "payload.json", { type: "application/json" }),
				],
			},
			{
				temporaryDirectory,
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

	it("rejects unsupported temporary upload file types", async () => {
		let wrote = false;
		const result = await createTemporaryUploads(
			{ files: [new File(["pdf data"], "document.pdf", { type: "application/pdf" })] },
			{
				temporaryDirectory: "/tmp/ryot-uploads",
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

	it("rejects empty temporary upload requests", async () => {
		const result = await createTemporaryUploads({ files: [] }, {});

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
