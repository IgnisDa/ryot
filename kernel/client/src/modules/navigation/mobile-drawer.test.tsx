import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot/ryotql-recipes/plugin-client-catalog";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";

import type { AuthSessionStore } from "#/modules/auth/client";
import { MobileDrawer } from "#/modules/navigation/mobile-drawer";

const workspace = (
	overrides: Partial<PluginClientCatalogEntry> = {},
): PluginClientCatalogEntry => ({
	icon: "film",
	sortOrder: 0,
	name: "Media",
	slug: "media",
	health: "ready",
	isDisabled: false,
	clientApiVersion: 1,
	pluginId: "plugin-media",
	sourceHash: "source-media",
	installationId: "installation-media",
	clientArtifactHash: "artifact-media",
	...overrides,
});

const snapshot = {
	status: "authenticated",
	user: { id: "user-1", name: "Test User", email: "user@ryot.test", image: null },
} as const;

const session: AuthSessionStore = {
	getSnapshot: () => snapshot,
	subscribe: () => () => undefined,
};

type HarnessProps = {
	readonly onNavigateHome?: () => void;
	readonly catalog?: PluginClientCatalog;
	readonly onSelectWorkspace?: (slug: string) => void;
};

function Harness(props: HarnessProps) {
	const current = workspace();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const [isOpen, setIsOpen] = useState(false);
	return (
		<>
			<button
				type="button"
				ref={triggerRef}
				aria-expanded={isOpen}
				aria-label="Open navigation"
				onClick={() => setIsOpen(true)}
			/>
			<MobileDrawer
				isPro={false}
				isOpen={isOpen}
				session={session}
				current={current}
				activeHome={true}
				drawerId="test-drawer"
				triggerRef={triggerRef}
				activeSettings={false}
				onNavigateSettings={() => undefined}
				catalog={props.catalog ?? [current]}
				onClose={() => setIsOpen(false)}
				onNavigateHome={() => props.onNavigateHome?.()}
				onSelectWorkspace={(slug) => props.onSelectWorkspace?.(slug)}
			/>
		</>
	);
}

const openDrawer = async () => {
	const trigger = screen.getByRole("button", { name: "Open navigation" });
	trigger.focus();
	fireEvent.click(trigger);
	return { dialog: await screen.findByRole("dialog", { name: "Navigation" }), trigger };
};

describe("mobile drawer", () => {
	it("closes on Escape, restores focus, and releases body scrolling", async () => {
		render(<Harness />);
		const { dialog, trigger } = await openDrawer();

		expect(document.body.style.overflow).toBe("hidden");
		fireEvent.keyDown(dialog, { key: "Escape" });

		await waitFor(() => expect(document.activeElement).toBe(trigger));
		expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
		expect(document.body.style.overflow).toBe("");
	});

	it("contains forward and reverse Tab focus", async () => {
		render(<Harness />);
		const { dialog } = await openDrawer();
		const first = screen.getByRole("button", { name: "Close navigation" });
		const last = screen.getByRole("link", { name: "Open settings" });

		first.focus();
		fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
		expect(document.activeElement).toBe(last);

		last.focus();
		fireEvent.keyDown(dialog, { key: "Tab" });
		expect(document.activeElement).toBe(first);
	});

	it("closes on backdrop click", async () => {
		render(<Harness />);
		const { dialog, trigger } = await openDrawer();

		fireEvent.click(dialog);

		await waitFor(() => expect(document.activeElement).toBe(trigger));
		expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
	});

	it("closes before Home and workspace navigation", async () => {
		let homeOpen: boolean | null = null;
		let selected: { readonly open: boolean; readonly slug: string } | null = null;
		const journal = workspace({
			sortOrder: 1,
			name: "Journal",
			slug: "journal",
			pluginId: "plugin-journal",
			sourceHash: "source-journal",
			installationId: "installation-journal",
			clientArtifactHash: "artifact-journal",
		});
		render(
			<Harness
				catalog={[workspace(), journal]}
				onNavigateHome={() => {
					homeOpen =
						screen.getByTestId("mobile-drawer").hasAttribute("open") ||
						document.body.style.overflow === "hidden";
				}}
				onSelectWorkspace={(slug) => {
					selected = {
						slug,
						open:
							screen.getByTestId("mobile-drawer").hasAttribute("open") ||
							document.body.style.overflow === "hidden",
					};
				}}
			/>,
		);
		await openDrawer();

		fireEvent.click(screen.getByRole("link", { name: "Home" }));
		await waitFor(() => expect(homeOpen).toBe(false));

		await openDrawer();
		fireEvent.click(screen.getByRole("button", { name: "Media workspace, media" }));
		fireEvent.click(screen.getByRole("button", { name: "Switch to Journal workspace" }));

		await waitFor(() => expect(selected).toEqual({ slug: "journal", open: false }));
	});
});
