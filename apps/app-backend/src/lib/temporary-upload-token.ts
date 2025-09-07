import { generateId } from "better-auth";

import { redis } from "~/lib/redis";
import { redisKeys, redisValues } from "~/lib/redis-keys";

export const UPLOAD_TOKEN_TTL_SECONDS = 15 * 60;

export type UploadTokenRedis = {
	getdel(key: string): Promise<string | null>;
	set(key: string, value: string, exMode: "EX", ttlSeconds: number): Promise<"OK">;
};

export type UploadTokenDeps = {
	redis?: UploadTokenRedis;
	generateToken?: () => string;
};

const defaultDeps: Required<UploadTokenDeps> = {
	// oxlint-disable-next-line no-unsafe-type-assertion
	generateToken: generateId,
	redis: redis as UploadTokenRedis,
};

/**
 * Records a temporary upload file as belonging to a user. Returns an opaque
 * token the client can pass to the import endpoint. The token expires after
 * UPLOAD_TOKEN_TTL_SECONDS and is single-use: claimUploadToken deletes it.
 */
export const storeUploadToken = async (
	input: { userId: string; resolvedPath: string },
	deps: UploadTokenDeps = {},
): Promise<string> => {
	const r = deps.redis ?? defaultDeps.redis;
	const generateToken = deps.generateToken ?? defaultDeps.generateToken;
	const token = generateToken();
	const value = { userId: input.userId, resolvedPath: input.resolvedPath };
	await r.set(
		redisKeys.imports.uploadToken(token),
		redisValues.imports.uploadToken.stringify(value),
		"EX",
		UPLOAD_TOKEN_TTL_SECONDS,
	);
	return token;
};

/**
 * Validates ownership of an upload token and returns the stored path.
 * Deletes the token from Redis (single-use). Returns an error string if
 * the token is missing, expired, or belongs to a different user.
 */
export const claimUploadToken = async (
	token: string,
	userId: string,
	deps: UploadTokenDeps = {},
): Promise<{ resolvedPath: string } | { error: string }> => {
	const r = deps.redis ?? defaultDeps.redis;
	const key = redisKeys.imports.uploadToken(token);
	const raw = await r.getdel(key);

	if (!raw) {
		return { error: "Upload token is invalid or has expired" };
	}

	const parsed = redisValues.imports.uploadToken.safeParse(raw);
	if (!parsed.success) {
		return { error: "Upload token is invalid or has expired" };
	}

	const value = parsed.data;

	if (value.userId !== userId) {
		return { error: "Upload token does not belong to this user" };
	}

	return { resolvedPath: value.resolvedPath };
};
