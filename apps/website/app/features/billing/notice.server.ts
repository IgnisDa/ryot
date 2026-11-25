import type { PurchaseCompleteEmailProps } from "@ryot-app/email-templates/emails/purchase-complete";
import { createSha256Hasher } from "@ryot-app/ts-utils/crypto";
import { Effect, Schema } from "effect";
import { SecureRandom } from "effect/crypto";

import { getServerVariables } from "~/server/config.server";
import { fromPromise } from "~/server/effect.server";

const Notice = Schema.fromJsonString(
	Schema.Union([
		Schema.Struct({ key: Schema.String, kind: Schema.Literal("self_hosted") }),
		Schema.Struct({
			kind: Schema.Literal("cloud"),
			auth: Schema.Union([
				Schema.Struct({ email: Schema.String, provider: Schema.Literal("google") }),
				Schema.Struct({
					username: Schema.String,
					passwordChangeUrl: Schema.String,
					provider: Schema.Literal("password"),
				}),
			]),
		}),
	]),
);

const noticeKey = () =>
	fromPromise(() =>
		crypto.subtle.importKey(
			"raw",
			Uint8Array.from(
				createSha256Hasher()
					.update("ryot-website-billing-notice\0")
					.update(getServerVariables().SERVER_ADMIN_ACCESS_TOKEN)
					.digest(),
			),
			"AES-GCM",
			false,
			["encrypt", "decrypt"],
		),
	);

export const sealNotice = Effect.fn(function* (
	details: NonNullable<PurchaseCompleteEmailProps["details"]>,
) {
	const key = yield* noticeKey();
	const random = yield* SecureRandom.SecureRandom;
	const iv = Uint8Array.from(yield* random.randomBytes(12));
	const content = yield* Schema.encodeEffect(Notice)(details);
	const encrypted = yield* fromPromise(() =>
		crypto.subtle.encrypt({ iv, name: "AES-GCM" }, key, new TextEncoder().encode(content)),
	);
	return Buffer.concat([iv, Buffer.from(encrypted)]).toString("base64");
});

export const openNotice = Effect.fn(function* (notice: string) {
	const key = yield* noticeKey();
	const bytes = Buffer.from(notice, "base64");
	const content = yield* fromPromise(() =>
		crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)),
	);
	return yield* Schema.decodeEffect(Notice)(new TextDecoder().decode(content));
});
