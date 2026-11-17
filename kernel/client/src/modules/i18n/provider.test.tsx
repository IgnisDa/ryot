import { describe, expect, it } from "bun:test";

import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import { catalog as sourceCatalog } from "@ryot-app/kernel-messages/locales/en";
import { testCatalog } from "@ryot-app/plugin-client-sdk/testing";
import { act, render, screen } from "@testing-library/react";
import { Effect } from "effect";

import { KernelI18nProvider } from "#/modules/i18n/provider";
import { createI18nStore } from "#/modules/i18n/store";

function Label(props: { readonly message: Message }) {
	return <p>{useT()(props.message)}</p>;
}

describe("kernel i18n provider", () => {
	it("renders a loading placeholder for plugin messages until their catalogs settle", () => {
		const pending: Array<Effect.Effect<void>> = [];
		const store = createI18nStore({
			sourceCatalog,
			deviceLocales: [],
			run: (effect) => pending.push(effect),
			load: () => Effect.succeed(sourceCatalog),
		});
		const { catalog } = testCatalog("plugin-1", { "plugin.name": "Fixture" });
		store.setPluginCatalogLoader(() => Effect.succeed([{ catalog, namespace: "plugin-1" }]));
		render(
			<KernelI18nProvider store={store}>
				<Label message={{ key: "plugin.name", namespace: "plugin-1" }} />
				<Label message={{ key: "plugin.name", namespace: "plugin-2" }} />
				<Label message={{ key: "missing.key", namespace: "kernel" }} />
			</KernelI18nProvider>,
		);

		expect(screen.getAllByText("…")).toHaveLength(2);
		expect(screen.getByText("This message is no longer available.")).toBeTruthy();

		act(() => {
			for (const effect of pending.splice(0)) {
				Effect.runSync(effect);
			}
		});

		expect(screen.getByText("Fixture")).toBeTruthy();
		expect(screen.queryByText("…")).toBeNull();
		expect(screen.getAllByText("This message is no longer available.")).toHaveLength(2);
	});
});
