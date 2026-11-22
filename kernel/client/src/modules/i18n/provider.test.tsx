import { describe, expect, it } from "bun:test";

import type { Message } from "@ryot-app/i18n/message";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import { catalog as sourceCatalog } from "@ryot-app/kernel-messages/locales/en";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { testCatalog } from "@ryot-app/plugin-client-sdk/testing";
import { act, render, screen } from "@testing-library/react";
import { Effect } from "effect";

import { KernelI18nProvider } from "#/modules/i18n/provider";
import { createI18nStore } from "#/modules/i18n/store";

function Label(props: { readonly message: Message }) {
	return <p>{useT()(props.message)}</p>;
}

function RegionalDate() {
	const date = useFormatters().dateTime({
		day: "2-digit",
		year: "numeric",
		timeZone: "UTC",
		month: "2-digit",
	});
	return <p>{date.format(Date.UTC(2026, 10, 21))}</p>;
}

describe("kernel i18n provider", () => {
	it("renders day-first dates alongside the English catalog for an Australian account", () => {
		const store = createI18nStore({
			sourceCatalog,
			deviceLocales: ["en-US"],
			initialPreference: "en-AU",
			run: (effect) => Effect.runSync(effect),
			load: () => Effect.succeed(sourceCatalog),
		});
		render(
			<KernelI18nProvider store={store}>
				<Label message={kernelMessage("notification.title")} />
				<RegionalDate />
			</KernelI18nProvider>,
		);
		expect(document.documentElement.lang).toBe("en");
		expect(screen.getByText("Ryot")).toBeTruthy();
		expect(screen.getByText("21/11/2026")).toBeTruthy();
	});

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
