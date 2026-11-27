import { afterEach, describe, expect } from "bun:test";

import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { localMessageBuilder, type TextArgument } from "@ryot-app/i18n/builder";
import { KERNEL_NAMESPACE } from "@ryot-app/i18n/message";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { waitFor } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { useDisplayText, useLocalMessage, useMessages } from "../react";
import {
	disposePluginBridges,
	entityLocation,
	entityPageContext,
	mountPluginPage,
	pluginContributor,
	testBridgeLocale,
} from "../testing";

const packageId = PluginPackageId.make("test/messages");
const catalogMessage = localMessageBuilder<{
	readonly "greeting.hello": { readonly name: TextArgument };
}>();

const catalog = (locale: string, hello: string) => ({
	locale,
	namespace: "messages-owner",
	catalog: {
		"greeting.hello": [
			{ type: 0, value: hello },
			{ type: 1, value: "name" },
		],
	} as const,
});

function Greeting() {
	const m = useMessages(packageId, catalogMessage);
	const local = useLocalMessage(packageId);
	const display = useDisplayText();
	return (
		<p>
			{m("greeting.hello", { name: "Ana" })}|
			{local({ key: "greeting.hello", params: { name: "Bo" } })}|{display("Custom")}|
			{m("common.action.cancel")}
		</p>
	);
}

const page = {
	...entityPageContext({
		entityId: "entity-1",
		exportName: "greeting",
		entitySchemaSlug: "item",
		pluginId: "messages-owner",
	}),
	contributors: [pluginContributor({ packageId, name: "messages", pluginId: "messages-owner" })],
};

afterEach(disposePluginBridges);

describe("plugin messages", () => {
	it.live(
		"stamps the resolved plugin namespace, renders kernel common messages and follows the host locale, direction and pending catalogs",
		() =>
			Effect.gen(function* () {
				const mounted = mountPluginPage(Greeting, {
					page,
					catalogs: [catalog("en", "Hello ")],
					location: entityLocation("entity-1", "item"),
				});
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(mounted.container?.textContent).toBe("Hello Ana|Hello Bo|Custom|Cancel"),
					),
				);
				expect(document.documentElement.lang).toBe("en");
				expect(document.documentElement.dir).toBe("ltr");
				const english = testBridgeLocale([catalog("en", "Hello ")]);
				mounted.send({
					...english,
					locale: "pt",
					type: "locale",
					catalogs: [
						...english.catalogs,
						{ catalog: {}, locale: "pt", namespace: KERNEL_NAMESPACE },
						catalog("pt", "Olá "),
					],
				});
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(mounted.container?.textContent).toBe("Olá Ana|Olá Bo|Custom|Cancel"),
					),
				);
				expect(document.documentElement.lang).toBe("pt");
				mounted.send({
					...english,
					dir: "rtl",
					locale: "ar",
					type: "locale",
					pendingNamespaces: ["messages-owner"],
					catalogs: testBridgeLocale([{ catalog: {}, locale: "ar", namespace: KERNEL_NAMESPACE }])
						.catalogs,
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(mounted.container?.textContent).toBe("…|…|Custom|Cancel")),
				);
				expect(document.documentElement.lang).toBe("ar");
				expect(document.documentElement.dir).toBe("rtl");
			}),
		testTimeout,
	);
});
