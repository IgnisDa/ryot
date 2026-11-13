import { expect } from "bun:test";

import { DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import { BadRequest } from "@ryot-app/contract/errors";
import {
	ASSISTANT_DEFAULT_MODEL_LIMITS,
	AssistantError,
} from "@ryot-app/contract/modules/assistant/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { layer } from "@voila.dev/effect-bun-test";
import { eq, sql } from "drizzle-orm";
import { Effect, Layer, Option, Redacted } from "effect";

import { PluginConfigEncryptionKey } from "#modules/plugins/configuration/encryption-key";
import { DatabaseSession } from "#platform/db/session";
import { user } from "#schema/tables/auth";
import { pluginConfigEncryptionKey } from "#schema/tables/core";
import { makeAppConfigLayer } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { AssistantProviderConfiguration } from "./provider-configuration";
import { AssistantProviderRepository } from "./provider-repository";

const owner = UserId.make("provider-owner");
const other = UserId.make("provider-other");
const baseUrl = "http://localhost:11434/v1";
const instance = {
	hasApiKey: true,
	contextWindow: 200_000,
	model: "instance-model",
	source: "instance" as const,
	baseUrl: "https://instance.example/v1",
	maxOutputTokens: ASSISTANT_DEFAULT_MODEL_LIMITS.maxOutputTokens,
};
const database = Layer.effectDiscard(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db.insert(user).values([
				{ id: owner, name: "Owner", email: "provider-owner@example.test" },
				{ id: other, name: "Other", email: "provider-other@example.test" },
			]),
		);
	}),
).pipe(Layer.provideMerge(isolatedDatabaseLayer("assistant_provider")));
const config = makeAppConfigLayer({
	server: {
		assistant: {
			model: Option.some(instance.model),
			baseUrl: Option.some(instance.baseUrl),
			contextWindow: Option.some(instance.contextWindow),
			apiKey: Option.some(Redacted.make("instance-secret")),
		},
	},
});
const dependencies = Layer.mergeAll(database, config);
const services = Layer.mergeAll(
	AssistantProviderConfiguration.layer,
	AssistantProviderRepository.layer,
	PluginConfigEncryptionKey.layer,
).pipe(Layer.provideMerge(dependencies));

layer(services)((test) => {
	test.effect(
		"user override wins, omitted key is retained, and removal restores instance settings",
		() =>
			Effect.gen(function* () {
				const providers = yield* AssistantProviderConfiguration;
				const repository = yield* AssistantProviderRepository;
				expect(yield* providers.metadata(owner)).toEqual(instance);
				yield* providers.configure(owner, "standard", {
					baseUrl,
					model: "user-model",
					apiKey: "user-secret",
					maxOutputTokens: 8_000,
				});
				const original = yield* repository.find(owner);
				assert(original?.encryptedApiKey);
				expect(original.encryptedApiKey.ciphertext).not.toContain("user-secret");
				expect(yield* providers.metadata(owner)).toEqual({
					baseUrl,
					source: "user",
					hasApiKey: true,
					model: "user-model",
					maxOutputTokens: 8_000,
					contextWindow: ASSISTANT_DEFAULT_MODEL_LIMITS.contextWindow,
				});
				assertExitFails(
					yield* Effect.exit(
						providers.configure(owner, "standard", {
							baseUrl,
							model: "user-model",
							contextWindow: 8_000,
							maxOutputTokens: 8_000,
						}),
					),
					new BadRequest({ message: "Maximum output tokens must be below the context window" }),
				);
				expect(yield* providers.metadata(other)).toEqual(instance);
				yield* providers.configure(owner, "standard", { baseUrl, model: "changed" });
				expect((yield* repository.find(owner))?.encryptedApiKey).toEqual(original.encryptedApiKey);
				const effective = yield* providers.effective(owner);
				assert(effective?.apiKey);
				expect(Redacted.value(effective.apiKey)).toBe("user-secret");
				yield* providers.remove(owner, "standard");
				expect(yield* repository.find(owner)).toBeNull();
				expect(yield* providers.metadata(owner)).toEqual(instance);
			}),
	);
	test.effect("allows a keyless local override and refuses demo changes", () =>
		Effect.gen(function* () {
			const providers = yield* AssistantProviderConfiguration;
			const repository = yield* AssistantProviderRepository;
			yield* providers.configure(owner, "standard", { baseUrl, model: "local" });
			expect(yield* providers.metadata(owner)).toEqual({
				...ASSISTANT_DEFAULT_MODEL_LIMITS,
				baseUrl,
				model: "local",
				source: "user",
				hasApiKey: false,
			});
			expect((yield* repository.find(owner))?.encryptedApiKey).toBeNull();
			for (const work of [
				providers.configure(owner, "demo", { baseUrl, model: "forbidden" }),
				providers.remove(owner, "demo"),
			]) {
				assertExitFails(
					yield* Effect.exit(work),
					new DemoOperationProtected({ reason: { code: "demo-operation-protected" } }),
				);
			}
			expect((yield* repository.find(owner))?.model).toBe("local");
			yield* providers.remove(owner, "standard");
		}),
	);
	test.effect(
		"authenticates ciphertext ownership and refuses regeneration when the retained key is lost",
		() =>
			Effect.gen(function* () {
				const providers = yield* AssistantProviderConfiguration;
				const repository = yield* AssistantProviderRepository;
				const session = yield* DatabaseSession;
				const keys = yield* PluginConfigEncryptionKey;
				yield* providers.configure(owner, "standard", {
					baseUrl,
					model: "private",
					apiKey: "owned-secret",
				});
				const original = yield* repository.find(owner);
				assert(original?.encryptedApiKey);
				yield* session.transaction(
					repository.put(other, {
						baseUrl,
						model: "copied",
						encryptedApiKey: original.encryptedApiKey,
					}),
				);
				assertExitFails(
					yield* Effect.exit(providers.effective(other)),
					new AssistantError({ reason: { code: "provider-unavailable" } }),
				);
				yield* session.run((db) => db.delete(pluginConfigEncryptionKey));
				expect((yield* Effect.flip(keys.load)).message).toContain("encryption key is missing");
				expect(yield* session.run((db) => db.select().from(pluginConfigEncryptionKey))).toEqual([]);
				yield* providers.remove(owner, "standard");
				yield* providers.remove(other, "standard");
				expect((yield* keys.load).activeKeyId).not.toBe(original.encryptedApiKey.keyId);
			}),
	);
	test.effect("refuses provider writes after lifecycle retirement starts", () =>
		Effect.gen(function* () {
			const providers = yield* AssistantProviderConfiguration;
			const repository = yield* AssistantProviderRepository;
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db
					.update(user)
					.set({ retiringAt: sql`now()` })
					.where(eq(user.id, other)),
			);
			expect(
				(yield* Effect.flip(providers.configure(other, "standard", { baseUrl, model: "blocked" })))
					.message,
			).toBe("Mutation command account is being retired");
			expect(yield* repository.find(other)).toBeNull();
			expect((yield* Effect.flip(providers.remove(other, "standard"))).message).toBe(
				"Mutation command account is being retired",
			);
		}),
	);
});
