import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";

import { credentialImportSchema, listedImportSource, uploadImportSchema } from "./import-fixture";
import { ImportSourcePicker } from "./import-source-picker";
import { mapImportSourceList } from "./state";

const sources = [
	listedImportSource({ slug: "ledger", name: "Ledger" }),
	listedImportSource({
		slug: "archive",
		name: "Archive",
		description: "Bring over a full backup",
		inputSchema: uploadImportSchema({ extensions: ["zip"] }),
	}),
	listedImportSource({
		slug: "scale",
		name: "Scale",
		pluginSlug: "fitness",
		inputSchema: credentialImportSchema,
	}),
	listedImportSource({
		slug: "vault",
		name: "Vault",
		isStartable: false,
		inputSchema: credentialImportSchema,
		missingPluginConfigKeys: ["RYOT_PLUGIN_MEDIA_ACCESS_TOKEN"],
	}),
];

const renderPicker = (
	overrides: {
		readonly onRetry?: () => void;
		readonly onChoose?: (slug: string) => void;
		readonly state?: Parameters<typeof ImportSourcePicker>[0]["state"];
	} = {},
) =>
	render(
		<ImportSourcePicker
			onRetry={overrides.onRetry ?? (() => undefined)}
			onChoose={overrides.onChoose ?? (() => undefined)}
			state={overrides.state ?? mapImportSourceList(AsyncResult.success(sources))}
		/>,
	);

describe("import source picker", () => {
	it("waits while the services load", async () => {
		await renderPicker({ state: mapImportSourceList(AsyncResult.initial(true)) });

		expect(screen.getByText("Loading the services you can import from...")).toBeOnTheScreen();
	});

	it("offers a retry and hides transport detail when the list fails", async () => {
		const user = userEvent.setup();
		const retries: number[] = [];
		await renderPicker({
			onRetry: () => retries.push(1),
			state: mapImportSourceList(AsyncResult.failure(Cause.fail(new Error("ECONNREFUSED")))),
		});

		await user.press(screen.getByRole("button", { name: "Try again" }));

		expect(screen.getByText("Unable to load services")).toBeOnTheScreen();
		expect(screen.queryByText(/ECONNREFUSED/)).not.toBeOnTheScreen();
		expect(retries).toEqual([1]);
	});

	it("explains an empty catalogue instead of showing a bare list", async () => {
		await renderPicker({ state: mapImportSourceList(AsyncResult.success([])) });

		expect(screen.getByText("No services yet")).toBeOnTheScreen();
	});

	it("groups services by plugin and states the input each one needs", async () => {
		await renderPicker();

		expect(screen.getByText("Media")).toBeOnTheScreen();
		expect(screen.getByText("Fitness")).toBeOnTheScreen();
		expect(screen.getByText("ZIP file")).toBeOnTheScreen();
		expect(screen.getAllByText("Server")).toHaveLength(2);
		expect(screen.getByText("CSV file")).toBeOnTheScreen();
	});

	it("chooses a service on a single press", async () => {
		const user = userEvent.setup();
		const chosen: string[] = [];
		await renderPicker({ onChoose: (slug) => chosen.push(slug) });

		await user.press(screen.getByRole("button", { name: "Import from Ledger" }));

		expect(chosen).toEqual(["ledger"]);
		expect(screen.queryByRole("button", { name: "Continue" })).not.toBeOnTheScreen();
	});

	it("keeps an unconfigured service visible and inert, naming what it needs", async () => {
		const user = userEvent.setup();
		const chosen: string[] = [];
		await renderPicker({ onChoose: (slug) => chosen.push(slug) });
		const vault = screen.getByRole("button", { name: "Vault is unavailable" });

		await user.press(vault);

		expect(vault).toBeDisabled();
		expect(chosen).toEqual([]);
		expect(
			screen.getByText("Set RYOT_PLUGIN_MEDIA_ACCESS_TOKEN on your server to use this."),
		).toBeOnTheScreen();
	});

	it("filters the list by name and description", async () => {
		const user = userEvent.setup();
		await renderPicker();

		await user.type(screen.getByLabelText("Search services"), "backup");

		expect(screen.getByRole("button", { name: "Import from Archive" })).toBeOnTheScreen();
		expect(screen.queryByRole("button", { name: "Import from Ledger" })).not.toBeOnTheScreen();
		expect(screen.queryByText("Fitness")).not.toBeOnTheScreen();
	});

	it("says so when the search matches nothing", async () => {
		const user = userEvent.setup();
		await renderPicker();

		await user.type(screen.getByLabelText("Search services"), "zzz");

		expect(screen.getByText("Nothing matches that")).toBeOnTheScreen();
	});

	it("starts the only matching service from the search field", async () => {
		const user = userEvent.setup();
		const chosen: string[] = [];
		await renderPicker({ onChoose: (slug) => chosen.push(slug) });
		const search = screen.getByLabelText("Search services");

		await user.type(search, "Archive", { submitEditing: true });

		expect(chosen).toEqual(["archive"]);
	});
});
