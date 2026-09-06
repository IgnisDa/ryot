import { NotificationChannelId } from "@ryot-app/contract/schema/brands";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NotificationChannelsView } from "#/modules/notifications/channels-view";

const channel = {
	isDisabled: false,
	channel: "discord" as const,
	description: "Library alerts",
	createdAt: "2026-09-20T08:00:00.000Z",
	updatedAt: "2026-09-20T08:00:00.000Z",
	id: NotificationChannelId.make("channel-1"),
};

const renderView = (isDemoProtected: boolean) => {
	const actions: string[] = [];
	render(
		<NotificationChannelsView
			enabledCount={1}
			isTesting={false}
			testSucceeded={false}
			isLoadingMore={false}
			testDetail={undefined}
			onRetry={() => undefined}
			deleteFailedId={undefined}
			onShowMore={() => undefined}
			pendingChannelId={undefined}
			onAdd={() => actions.push("add")}
			isDemoProtected={isDemoProtected}
			onSendTest={() => actions.push("test")}
			onDelete={() => actions.push("delete")}
			onToggle={() => actions.push("toggle")}
			nowMs={Date.parse("2026-09-20T09:00:00.000Z")}
			state={{ hasMore: false, status: "ready", channels: [channel] }}
		/>,
	);
	return actions;
};

describe("notification channel demo protection", () => {
	it("keeps mutation controls visible and disabled for demo sessions", () => {
		const actions = renderView(true);
		const controls = [
			screen.getByRole("button", { name: "Add a channel" }),
			screen.getByRole("button", { name: "Send a test notification to every enabled channel" }),
			screen.getByRole("switch", { name: "Pause the Discord channel" }),
			screen.getByRole("button", { name: "Delete the Discord channel" }),
		];

		expect(
			screen.getByText("This operation is unavailable while using the shared demo account."),
		).toBeTruthy();
		for (const control of controls) {
			expect(control.hasAttribute("disabled")).toBe(true);
			fireEvent.click(control);
		}
		expect(actions).toEqual([]);
	});

	it("retains standard session behavior", () => {
		const actions = renderView(false);
		fireEvent.click(screen.getByRole("button", { name: "Add a channel" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Send a test notification to every enabled channel" }),
		);
		fireEvent.click(screen.getByRole("switch", { name: "Pause the Discord channel" }));
		fireEvent.click(screen.getByRole("button", { name: "Delete the Discord channel" }));

		expect(actions).toEqual(["add", "test", "toggle"]);
		expect(screen.getByRole("dialog")).toBeTruthy();
	});
});
