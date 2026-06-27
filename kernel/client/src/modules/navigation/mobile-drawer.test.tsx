import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type MotionValue, motionValue, useMotionValue } from "motion/react";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";

import type { AuthSessionStore } from "#/modules/auth/service";
import { MobileDrawer } from "#/modules/navigation/mobile-drawer";
import type { SidebarSections } from "#/modules/navigation/sidebar-sections";

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

const sections: SidebarSections = {
	savedViews: [],
	collections: [],
	views: [
		{
			name: "Home",
			slug: "home",
			sortOrder: 0,
			kind: "home",
			icon: "house",
			pluginSlug: null,
			isDisabled: false,
		},
	],
};

type HarnessProps = {
	readonly hasDrawer?: boolean;
	readonly onClose?: () => void;
	readonly onNavigateHome?: () => void;
	readonly catalog?: PluginClientCatalog;
	readonly progress?: MotionValue<number>;
	readonly onSelectWorkspace?: (slug: string) => void;
};

function Harness(props: HarnessProps) {
	const current = workspace();
	const fallback = useMotionValue(0);
	const progress = props.progress ?? fallback;
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
				activeKey={null}
				session={session}
				current={current}
				activeHome={true}
				progress={progress}
				sections={sections}
				drawerId="test-drawer"
				activeSettings={false}
				triggerRef={triggerRef}
				onCustomize={() => undefined}
				onOpenSearch={() => undefined}
				onNavigateItem={() => undefined}
				hasDrawer={props.hasDrawer ?? true}
				onNavigateSettings={() => undefined}
				catalog={props.catalog ?? [current]}
				onNavigateHome={() => props.onNavigateHome?.()}
				onSelectWorkspace={(slug) => props.onSelectWorkspace?.(slug)}
				onClose={() => {
					props.onClose?.();
					setIsOpen(false);
				}}
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

	it("passes an axe pass while open", async () => {
		render(<Harness />);
		await openDrawer();

		const results = await axe(document.body, { rules: { "color-contrast": { enabled: false } } });

		expect(results.violations.map((violation) => violation.id)).toEqual([]);
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

	it("stays mounted off its route until the closing panel settles off screen", () => {
		const progress = motionValue(0);
		render(<Harness progress={progress} hasDrawer={false} />);

		expect(screen.queryByTestId("mobile-drawer")).toBeNull();

		act(() => progress.set(0.5));
		expect(screen.getByTestId("mobile-drawer")).toBeTruthy();

		act(() => progress.set(0));
		expect(screen.queryByTestId("mobile-drawer")).toBeNull();
	});

	it("closes on scrim click", async () => {
		render(<Harness />);
		const { trigger } = await openDrawer();

		fireEvent.click(screen.getByTestId("drawer-scrim"));

		await waitFor(() => expect(document.activeElement).toBe(trigger));
		expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
	});

	it("releases body scrolling before it reports the close", async () => {
		const overflow: Array<string> = [];
		render(<Harness onClose={() => overflow.push(document.body.style.overflow)} />);
		await openDrawer();

		expect(document.body.style.overflow).toBe("hidden");
		fireEvent.click(screen.getByRole("link", { name: "Home" }));

		expect(overflow).toEqual([""]);
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
						screen.queryByRole("dialog", { name: "Navigation" }) !== null ||
						document.body.style.overflow === "hidden";
				}}
				onSelectWorkspace={(slug) => {
					selected = {
						slug,
						open:
							screen.queryByRole("dialog", { name: "Navigation" }) !== null ||
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
		fireEvent.click(screen.getByRole("menuitemradio", { name: "Switch to Journal workspace" }));

		await waitFor(() => expect(selected).toEqual({ slug: "journal", open: false }));
	});
});
