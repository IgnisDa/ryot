import { describe, expect, it } from "bun:test";

import { catalogRegistry } from "@ryot-app/i18n/catalog";
import { I18nProvider } from "@ryot-app/i18n/react";
import { catalog as germanCatalog } from "@ryot-app/kernel-messages/locales/de";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { testCatalog } from "@ryot-app/plugin-client-sdk/testing";
import { fireEvent, render, screen } from "@testing-library/react";

import {
	testI18nWrapper,
	testMessage,
	testMessageCatalog,
} from "#/modules/i18n/provider.test-support";
import { ProviderSearchResultRow } from "#/modules/provider-add/result-row";

const item = { externalId: "fixture", title: "Fixture item" };

describe("provider search result row", () => {
	it("renders the plugin entry action and its accessible name in the active locale", () => {
		const adds: boolean[] = [];
		const registry = catalogRegistry([
			{ locale: "de", namespace: "kernel", catalog: germanCatalog },
			{ ...testCatalog("fixture", { "library.plan": "Vormerken" }), locale: "de" },
		]);
		render(
			<I18nProvider locale="de" registry={registry}>
				<ProviderSearchResultRow
					item={item}
					entry={{ status: "idle" }}
					linkedEntityId={undefined}
					onAdd={(value) => adds.push(value)}
					entryEventLabel={{ key: "library.plan", namespace: "fixture" }}
				/>
			</I18nProvider>,
		);
		const action = screen.getByRole("button", { name: "Vormerken: Fixture item" });
		expect(action.textContent).toBe("Vormerken");
		fireEvent.click(action);
		expect(adds).toEqual([true]);
	});
	it("shows the queued and importing states and clears the busy state when idle", () => {
		let addCount = 0;
		const onAdd = () => {
			addCount += 1;
		};
		const view = render(
			<ProviderSearchResultRow
				item={item}
				onAdd={onAdd}
				entry={{ status: "idle" }}
				linkedEntityId={undefined}
			/>,
			{ wrapper: testI18nWrapper() },
		);

		fireEvent.click(screen.getByRole("button", { name: "Add Fixture item" }));
		expect(addCount).toBe(1);

		view.rerender(
			<ProviderSearchResultRow
				item={item}
				onAdd={onAdd}
				linkedEntityId={undefined}
				entry={{ status: "queued" }}
			/>,
		);
		expect(screen.getByRole("status", { name: "Queued Fixture item" }).textContent).toContain(
			"Queued",
		);
		expect(screen.queryByRole("button", { name: "Add Fixture item" })).toBeNull();

		view.rerender(
			<ProviderSearchResultRow
				item={item}
				onAdd={onAdd}
				linkedEntityId={undefined}
				entry={{ status: "importing" }}
			/>,
		);
		const status = screen.getByRole("status", { name: "Adding Fixture item" });
		expect(status.textContent).toContain("Adding…");
		const spinner = status.querySelector('[aria-hidden="true"]');
		expect(spinner?.classList.contains("motion-reduce:animate-none")).toBe(true);
		expect(view.container.firstElementChild?.getAttribute("aria-busy")).toBe("true");

		view.rerender(
			<ProviderSearchResultRow
				item={item}
				onAdd={onAdd}
				entry={{ status: "idle" }}
				linkedEntityId={undefined}
			/>,
		);
		expect(view.container.firstElementChild?.getAttribute("aria-busy")).toBeNull();
	});

	it("shows a failed import message and retries the add", () => {
		let addCount = 0;
		const onAdd = () => {
			addCount += 1;
		};
		const view = render(
			<ProviderSearchResultRow
				item={item}
				onAdd={onAdd}
				linkedEntityId={undefined}
				entry={{ status: "importing" }}
			/>,
			{ wrapper: testI18nWrapper() },
		);

		view.rerender(
			<ProviderSearchResultRow
				item={item}
				onAdd={onAdd}
				linkedEntityId={undefined}
				entry={{ status: "failed", message: kernelMessage("client.provider-add.import.failed") }}
			/>,
		);
		expect(screen.queryByRole("status")).toBeNull();
		expect(
			screen.getByText("The provider could not import this item. Try again later."),
		).toBeTruthy();
		expect(view.container.firstElementChild?.getAttribute("aria-busy")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Retry adding Fixture item" }));
		expect(addCount).toBe(1);
	});

	it("adds with the entry event, retries with it, and hides it without a label", () => {
		const adds: boolean[] = [];
		const onAdd = (withEntryEvent: boolean) => {
			adds.push(withEntryEvent);
		};
		const view = render(
			<ProviderSearchResultRow
				item={item}
				onAdd={onAdd}
				entry={{ status: "idle" }}
				linkedEntityId={undefined}
				entryEventLabel={testMessage("Add to backlog")}
			/>,
			{ wrapper: testI18nWrapper([testMessageCatalog("Add to backlog")]) },
		);

		fireEvent.click(screen.getByRole("button", { name: "Add to backlog: Fixture item" }));
		fireEvent.click(screen.getByRole("button", { name: "Add Fixture item" }));
		expect(adds).toEqual([true, false]);

		fireEvent.click(screen.getByRole("button", { name: "Add to backlog: Fixture item" }));
		view.rerender(
			<ProviderSearchResultRow
				item={item}
				onAdd={onAdd}
				linkedEntityId={undefined}
				entryEventLabel={testMessage("Add to backlog")}
				entry={{ status: "failed", message: kernelMessage("client.provider-add.import.failed") }}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Retry adding Fixture item" }));
		expect(adds).toEqual([true, false, true, true]);

		view.rerender(
			<ProviderSearchResultRow
				item={item}
				onAdd={onAdd}
				entry={{ status: "idle" }}
				linkedEntityId={undefined}
			/>,
		);
		expect(screen.queryByRole("button", { name: "Add to backlog: Fixture item" })).toBeNull();
		expect(screen.getByRole("button", { name: "Add Fixture item" })).toBeTruthy();
	});
});
