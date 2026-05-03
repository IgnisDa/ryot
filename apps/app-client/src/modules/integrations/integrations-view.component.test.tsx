import { describe, expect, it } from "@jest/globals";
import { IntegrationId } from "@ryot/contract/schema/brands";
import { render, screen, userEvent } from "@testing-library/react-native";
import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";

import { RyotQLMalformedResultError } from "@/api/ryotql";

import { decodeIntegrationList, makeIntegrationSummary } from "./integration-fixture";
import { IntegrationsView } from "./integrations-view";
import { mapIntegrationList, type IntegrationListState } from "./state";

const NOW = Date.parse("2026-08-23T12:00:00.000Z");

const providerNames = new Map([
	["media:kodi", "Kodi"],
	["media:komga", "Komga"],
]);

const listState = (
	integrations: readonly ReturnType<typeof makeIntegrationSummary>[],
	hasMore = false,
) => mapIntegrationList(AsyncResult.success(decodeIntegrationList({ integrations, hasMore })));

const renderView = (
	state: IntegrationListState,
	overrides: {
		readonly onRetry?: () => void;
		readonly onConnect?: () => void;
		readonly onSyncAll?: () => void;
		readonly onShowMore?: () => void;
		readonly isLoadingMore?: boolean;
		readonly onOpenImports?: () => void;
		readonly onOpen?: (integrationId: string) => void;
	} = {},
) =>
	render(
		<IntegrationsView
			nowMs={NOW}
			state={state}
			providerNames={providerNames}
			onOpen={overrides.onOpen ?? (() => undefined)}
			onRetry={overrides.onRetry ?? (() => undefined)}
			isLoadingMore={overrides.isLoadingMore ?? false}
			onConnect={overrides.onConnect ?? (() => undefined)}
			onSyncAll={overrides.onSyncAll ?? (() => undefined)}
			onShowMore={overrides.onShowMore ?? (() => undefined)}
			onOpenImports={overrides.onOpenImports ?? (() => undefined)}
		/>,
	);

describe("integrations screen", () => {
	it("waits without claiming there are no integrations", async () => {
		await renderView(mapIntegrationList(AsyncResult.initial(true)));

		expect(screen.getByText("Loading your integrations...")).toBeOnTheScreen();
		expect(screen.queryByText("No integrations yet")).not.toBeOnTheScreen();
	});

	it("offers a retry and hides decoder internals when the query fails", async () => {
		const user = userEvent.setup();
		const retries: string[] = [];
		await renderView(
			mapIntegrationList(
				AsyncResult.failure(Cause.fail(new RyotQLMalformedResultError("bad rows"))),
			),
			{ onRetry: () => retries.push("retry") },
		);

		expect(screen.queryByText(/bad rows/)).not.toBeOnTheScreen();
		await user.press(screen.getByRole("button", { name: "Try again" }));

		expect(retries).toEqual(["retry"]);
	});

	it("invites a first connection when nothing is set up", async () => {
		const user = userEvent.setup();
		const opened: string[] = [];
		await renderView(listState([]), { onConnect: () => opened.push("connect") });

		expect(screen.getByText("No integrations yet")).toBeOnTheScreen();
		await user.press(screen.getByRole("button", { name: "Connect a service" }));

		expect(opened).toEqual(["connect"]);
	});

	it("names each integration and says how recently it synced", async () => {
		await renderView(
			listState([
				makeIntegrationSummary({ name: "Shelf", lastFinishedAt: "2026-08-23T11:00:00.000Z" }),
				makeIntegrationSummary({
					lot: "sink",
					provider: "kodi",
					isDisabled: true,
					id: IntegrationId.make("int_2"),
				}),
			]),
		);

		expect(screen.getByText("Shelf")).toBeOnTheScreen();
		expect(screen.getByText("Active · Synced 1 hour ago")).toBeOnTheScreen();
		expect(screen.getByText("Kodi")).toBeOnTheScreen();
		expect(screen.getByText("Paused · Never synced")).toBeOnTheScreen();
		expect(screen.getByText("Webhook")).toBeOnTheScreen();
	});

	it("opens the integration that was pressed", async () => {
		const user = userEvent.setup();
		const opened: string[] = [];
		await renderView(listState([makeIntegrationSummary({ name: "Shelf" })]), {
			onOpen: (id) => opened.push(id),
		});

		await user.press(screen.getByRole("button", { name: "Open the Shelf integration" }));

		expect(opened).toEqual(["int_1"]);
	});

	it("only offers to sync all when there is something to sync", async () => {
		const user = userEvent.setup();
		const synced: string[] = [];
		await renderView(listState([]));

		expect(screen.queryByRole("button", { name: "Sync all integrations" })).not.toBeOnTheScreen();

		await renderView(listState([makeIntegrationSummary()]), {
			onSyncAll: () => synced.push("sync"),
		});
		await user.press(screen.getByRole("button", { name: "Sync all integrations" }));

		expect(synced).toEqual(["sync"]);
	});

	it("only offers more when the page reports more", async () => {
		const user = userEvent.setup();
		const more: string[] = [];
		await renderView(listState([makeIntegrationSummary()], false));
		expect(screen.queryByRole("button", { name: "Show more integrations" })).not.toBeOnTheScreen();

		await renderView(listState([makeIntegrationSummary()], true), {
			onShowMore: () => more.push("more"),
		});
		await user.press(screen.getByRole("button", { name: "Show more integrations" }));

		expect(more).toEqual(["more"]);
	});
});
