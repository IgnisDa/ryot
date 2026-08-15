import { describe, expect, it } from "@jest/globals";
import { fireEvent, render, screen, userEvent } from "@testing-library/react-native";

import { CatalogPicker, type CatalogPickerState } from "./catalog-picker";
import type { CatalogEntry } from "./catalog-selection";

type Source = {
	name: string;
	slug: string;
	pluginSlug: string;
	description: string;
	isAvailable: boolean;
};

const copy = {
	emptyTitle: "No services yet",
	loadingLabel: "Loading services",
	errorSubject: "The list of services",
	errorTitle: "Unable to load services",
	loadingDetail: "Loading the services...",
	emptyDetail: "Once a plugin contributes one, it shows up here.",
};

const sources: readonly Source[] = [
	{
		slug: "netflix",
		name: "Netflix",
		isAvailable: true,
		pluginSlug: "media",
		description: "Viewing activity",
	},
	{
		slug: "audible",
		name: "Audible",
		isAvailable: false,
		pluginSlug: "media",
		description: "Listening activity",
	},
];

const toEntry = (source: Source): CatalogEntry => ({
	slug: source.slug,
	name: source.name,
	badge: "CSV file",
	description: source.description,
	isAvailable: source.isAvailable,
	requirement: source.isAvailable ? undefined : "Not ready on your server.",
});

const chooseLabel = (entry: CatalogEntry) =>
	entry.isAvailable ? `Choose ${entry.name}` : `${entry.name} is unavailable`;

const renderPicker = (
	state: CatalogPickerState<Source>,
	overrides: { onRetry?: () => void; onChoose?: (slug: string) => void } = {},
) =>
	render(
		<CatalogPicker
			copy={copy}
			state={state}
			toEntry={toEntry}
			chooseLabel={chooseLabel}
			onRetry={overrides.onRetry ?? (() => undefined)}
			onChoose={overrides.onChoose ?? (() => undefined)}
		/>,
	);

describe("catalog picker", () => {
	it("waits without claiming there are no services", async () => {
		await renderPicker({ status: "loading" });

		expect(screen.getByText(copy.loadingDetail)).toBeOnTheScreen();
		expect(screen.queryByText(copy.emptyTitle)).not.toBeOnTheScreen();
	});

	it("offers a retry when the query fails", async () => {
		const user = userEvent.setup();
		const retries: string[] = [];
		await renderPicker({ status: "transport-error" }, { onRetry: () => retries.push("retry") });

		expect(screen.getByText(copy.errorTitle)).toBeOnTheScreen();
		await user.press(screen.getByRole("button", { name: "Try again" }));

		expect(retries).toEqual(["retry"]);
	});

	it("groups entries under their plugin and chooses on press", async () => {
		const user = userEvent.setup();
		const chosen: string[] = [];
		await renderPicker({ status: "ready", sources }, { onChoose: (slug) => chosen.push(slug) });

		expect(screen.getByText("Media")).toBeOnTheScreen();
		await user.press(screen.getByRole("button", { name: "Choose Netflix" }));

		expect(chosen).toEqual(["netflix"]);
	});

	it("disables an unavailable entry and says why", async () => {
		await renderPicker({ status: "ready", sources });

		expect(screen.getByRole("button", { name: "Audible is unavailable" })).toBeDisabled();
		expect(screen.getByText("Not ready on your server.")).toBeOnTheScreen();
	});

	it("filters by the query and reports when nothing matches", async () => {
		const user = userEvent.setup();
		await renderPicker({ status: "ready", sources });

		await user.type(screen.getByLabelText("Search services"), "netflix");
		expect(screen.queryByRole("button", { name: "Audible is unavailable" })).not.toBeOnTheScreen();

		await user.clear(screen.getByLabelText("Search services"));
		await user.type(screen.getByLabelText("Search services"), "zzz");
		expect(screen.getByText("Nothing matches that")).toBeOnTheScreen();
	});

	it("submits straight through when the query leaves one usable entry", async () => {
		const user = userEvent.setup();
		const chosen: string[] = [];
		await renderPicker({ status: "ready", sources }, { onChoose: (slug) => chosen.push(slug) });

		await user.type(screen.getByLabelText("Search services"), "netflix");
		void fireEvent(screen.getByLabelText("Search services"), "submitEditing");

		expect(chosen).toEqual(["netflix"]);
	});
});
