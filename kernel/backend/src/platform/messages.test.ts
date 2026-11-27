import { expect } from "bun:test";

import { badRequest, DbError, SandboxRunError, validationFailed } from "@ryot-app/contract/errors";
import { EntityBadRequest, EntityNotFound } from "@ryot-app/contract/modules/entities/schemas";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { unavailableMessage } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { MessageCatalogSource, MessageRegistry } from "./messages";
import { emptyMessageCatalogs } from "./messages.test-support";

it.effect("renders model-facing failures in English and passes other failures through", () =>
	Effect.gen(function* () {
		const { errorForModel } = yield* MessageRegistry.make.pipe(
			Effect.provideService(MessageCatalogSource, emptyMessageCatalogs),
		);
		expect(
			yield* errorForModel(
				badRequest(kernelMessage("error.agent-tools.unknown-tool", { name: "describe" })),
			),
		).toBe("Unknown agent tool: describe.");
		expect(
			yield* errorForModel(validationFailed([{ path: ["query"], issue: "invalid-type" }])),
		).toBe('The request is not valid. [{"issue":"invalid-type","path":["query"]}]');
		expect(
			yield* errorForModel(
				new SandboxRunError({
					kind: "resource-unavailable",
					message: "Operation exceeded 30s",
					data: { code: "execution-limit" },
				}),
			),
		).toBe("The run exceeded its execution limits.");
		expect(
			yield* errorForModel(
				new EntityNotFound({
					reason: { code: "entity-not-found", entityId: EntityId.make("entity-1") },
				}),
			),
		).toBe('EntityNotFound: {"code":"entity-not-found","entityId":"entity-1"}');
		expect(
			yield* errorForModel(
				new EntityBadRequest({
					reason: {
						code: "policy-rejected",
						message: kernelMessage("error.sandbox.execution-limit"),
					},
				}),
			),
		).toBe(
			'EntityBadRequest: {"code":"policy-rejected","message":"The run exceeded its execution limits."}',
		);
		expect(yield* errorForModel({ message: "script failed" })).toBe("script failed");
	}),
);

it.effect("loads only the plugin namespaces a message references", () =>
	Effect.gen(function* () {
		const requests: Array<{ locale: string; namespaces: ReadonlyArray<string> }> = [];
		const source: MessageCatalogSource["Service"] = {
			load: (namespaces, locale) =>
				Effect.sync(() => {
					requests.push({ locale, namespaces });
					return [{ namespace: "plugin1", catalog: { "item.done": [{ type: 0, value: "Done" }] } }];
				}),
		};
		const { renderForModel } = yield* MessageRegistry.make.pipe(
			Effect.provideService(MessageCatalogSource, source),
		);
		expect(
			yield* renderForModel(
				kernelMessage("error.agent-tools.unknown-tool", {
					name: { key: "item.done", namespace: "plugin1" },
				}),
			),
		).toBe("Unknown agent tool: Done.");
		expect(yield* renderForModel({ key: "item.missing", namespace: "plugin1" })).toBe(
			yield* renderForModel(unavailableMessage),
		);
		expect(yield* renderForModel(kernelMessage("error.sandbox.execution-limit"))).toBe(
			"The run exceeded its execution limits.",
		);
		expect(requests).toEqual([
			{ locale: "en", namespaces: ["plugin1"] },
			{ locale: "en", namespaces: ["plugin1"] },
		]);
	}),
);

it.effect("renders along the locale's fallback chain for each plugin namespace", () =>
	Effect.gen(function* () {
		const requests: Array<{ locale: string; namespaces: ReadonlyArray<string> }> = [];
		const source: MessageCatalogSource["Service"] = {
			load: (namespaces, locale) =>
				Effect.sync(() => {
					requests.push({ locale, namespaces });
					return locale === "en"
						? [{ namespace: "plugin1", catalog: { "item.done": [{ type: 0, value: "Done" }] } }]
						: [];
				}),
		};
		const { renderer } = yield* MessageRegistry.make.pipe(
			Effect.provideService(MessageCatalogSource, source),
		);
		const { render } = yield* renderer("en-XA", ["plugin1", "kernel"]);
		expect(String(render({ key: "item.done", namespace: "plugin1" }))).toBe("Done");
		expect(String(render(kernelMessage("error.sandbox.execution-limit")))).not.toBe(
			"The run exceeded its execution limits.",
		);
		expect(requests).toEqual([
			{ locale: "en-XA", namespaces: ["plugin1"] },
			{ locale: "en", namespaces: ["plugin1"] },
		]);
	}),
);

it.effect("fails rendering when plugin catalogs cannot be loaded", () =>
	Effect.gen(function* () {
		const { renderer } = yield* MessageRegistry.make.pipe(
			Effect.provideService(MessageCatalogSource, {
				load: () => Effect.fail(new DbError({ message: "connection lost" })),
			}),
		);
		const error = yield* Effect.flip(renderer("en", ["plugin1"]));
		expect(error).toBeInstanceOf(DbError);
	}),
);
