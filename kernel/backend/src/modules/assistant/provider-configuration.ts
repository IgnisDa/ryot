import { DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import { BadRequest } from "@ryot-app/contract/errors";
import {
	AssistantError,
	type AssistantProviderMetadata,
	ConfigureAssistantProviderBody,
} from "@ryot-app/contract/modules/assistant/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Option, Redacted, Result, Schema } from "effect";

import { AccountAdmission } from "#modules/mutations/account-admission";
import { PluginConfigEncryptionKey } from "#modules/plugins/configuration/encryption-key";
import { parseHttpBaseUrl } from "#platform/config/http-base-url";
import { AppConfig } from "#platform/config/service";
import { DatabaseSession } from "#platform/db/session";

import { AssistantProviderRepository } from "./provider-repository";

export type AssistantProvider = Omit<AssistantProviderMetadata, "hasApiKey"> & {
	readonly apiKey: undefined | Redacted.Redacted;
};
const context = "ryot/assistant/provider-api-key";
const attribution = (userId: UserId) => ({ userId });
const unavailable = () => new AssistantError({ reason: { code: "provider-unavailable" } });
const requireMutable = (accessClass: "demo" | "standard") =>
	accessClass === "demo"
		? Effect.fail(new DemoOperationProtected({ reason: { code: "demo-operation-protected" } }))
		: Effect.void;

const validateAssistantProviderUrl = (baseUrl: string) => {
	const parsed = parseHttpBaseUrl(baseUrl);
	return Result.isSuccess(parsed)
		? Effect.succeed(parsed.success)
		: Effect.fail(
				new BadRequest({
					message: "Provider base URL must be HTTP or HTTPS without credentials, query or fragment",
				}),
			);
};

export class AssistantProviderConfiguration extends Context.Service<AssistantProviderConfiguration>()(
	"@ryot-app/kernel-backend/modules/assistant/provider-configuration/AssistantProviderConfiguration",
	{
		make: Effect.gen(function* () {
			const repository = yield* AssistantProviderRepository;
			const session = yield* DatabaseSession;
			const admission = yield* AccountAdmission.make;
			const keys = yield* PluginConfigEncryptionKey;
			const config = (yield* AppConfig).server.assistant;
			const effective = Effect.fn(function* (
				userId: UserId,
			): Effect.fn.Return<
				null | AssistantProvider,
				AssistantError | Effect.Error<ReturnType<typeof repository.find>>
			> {
				const row = yield* repository.find(userId);
				if (row !== null) {
					const ciphertext = row.encryptedApiKey;
					const apiKey =
						ciphertext === null
							? undefined
							: yield* Effect.gen(function* () {
									const encryption = yield* keys.load;
									return Redacted.make(
										yield* encryption.decryptWithSubkey(context, ciphertext, attribution(userId)),
									);
								}).pipe(Effect.mapError(unavailable));
					return { apiKey, source: "user", model: row.model, baseUrl: row.baseUrl };
				}
				if (Option.isNone(config.baseUrl) || Option.isNone(config.model)) {
					return null;
				}
				return {
					source: "instance",
					model: config.model.value,
					apiKey: Option.getOrUndefined(config.apiKey),
					baseUrl: config.baseUrl.value.replace(/\/+$/, ""),
				};
			});
			const metadata = Effect.fn(function* (
				userId: UserId,
			): Effect.fn.Return<
				null | AssistantProviderMetadata,
				Effect.Error<ReturnType<typeof effective>>
			> {
				const provider = yield* effective(userId);
				return provider === null
					? null
					: {
							model: provider.model,
							source: provider.source,
							baseUrl: provider.baseUrl,
							hasApiKey: provider.apiKey !== undefined,
						};
			});
			const configure = Effect.fn(function* (
				userId: UserId,
				accessClass: "demo" | "standard",
				input: ConfigureAssistantProviderBody,
			) {
				yield* requireMutable(accessClass);
				const validated = yield* Schema.decodeEffect(ConfigureAssistantProviderBody)(input);
				const baseUrl = yield* validateAssistantProviderUrl(validated.baseUrl);
				yield* session.transaction(
					Effect.gen(function* () {
						yield* session.acquireUserWriteLock(userId);
						yield* admission.admitAccount(userId);
						const previous = yield* repository.find(userId);
						const suppliedKey = validated.apiKey;
						let encryptedApiKey = previous?.encryptedApiKey ?? null;
						if (suppliedKey !== undefined) {
							const encryption = yield* keys.load;
							encryptedApiKey = yield* encryption.encryptWithSubkey(
								context,
								suppliedKey,
								attribution(userId),
							);
						}
						yield* repository.put(userId, { baseUrl, encryptedApiKey, model: validated.model });
					}),
				);
			});
			const remove = Effect.fn(function* (userId: UserId, accessClass: "demo" | "standard") {
				yield* requireMutable(accessClass);
				yield* session.transaction(
					Effect.gen(function* () {
						yield* session.acquireUserWriteLock(userId);
						yield* admission.admitAccount(userId);
						yield* repository.remove(userId);
					}),
				);
			});
			return { remove, metadata, effective, configure };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(AssistantProviderRepository.layer),
		Layer.provide(PluginConfigEncryptionKey.layer),
	);
}
