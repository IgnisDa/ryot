import { z } from "@hono/zod-openapi";

const entityRemoteVideoSchema = z
	.object({
		url: z.string().describe("URL of the remote video"),
		source: z.enum(["youtube", "dailymotion"]).describe("Video hosting platform"),
	})
	.strict();

export const entityAssetsSchema = z
	.object({
		s3Images: z.array(z.string()).describe("S3 image keys"),
		s3Videos: z.array(z.string()).describe("S3 video keys"),
		remoteImages: z.array(z.string()).describe("Remote image URLs"),
		remoteVideos: z.array(entityRemoteVideoSchema).describe("Remote hosted videos"),
	})
	.strict();

export const workoutSupersetSchema = z
	.object({
		color: z.string().describe("Display color for this superset"),
		exercises: z
			.array(z.number().int().nonnegative())
			.describe("Zero-based exercise positions in this superset"),
	})
	.strict()
	.describe("Superset grouping within a workout or template");
