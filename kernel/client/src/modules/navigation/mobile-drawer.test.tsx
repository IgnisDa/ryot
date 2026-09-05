import { describe, expect, it } from "@effect/vitest";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Effect } from "effect";
import { type MotionValue, motionValue, useMotionValue } from "motion/react";
import { useRef, useState } from "react";
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
	isHidden: false,
	clientApiVersion: 1,
	pluginId: "plugin-media",
	sourceHash: "source-media",
	installationId: "installation-media",
	...overrides,
	homeSavedViewSlug: overrides.homeSavedViewSlug ?? null,
});

const snapshot = {
	status: "authenticated",
	accessClass: "standard",
	user: { image: null, id: "user-1", name: "Test User", email: "user@ryot.test" },
} as const;

const session: AuthSessionStore = { getSnapshot: () => snapshot, subscribe: () => () => undefined };

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
			isHidden: false,
			pluginSlug: null,
		},
	],
};

const navigation: NavigationData = { savedViews: [], collections: [] };

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
				navigation={navigation}
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

const openDrawer = () => {
	const trigger = screen.getByRole("button", { name: "Open navigation" });
	trigger.focus();
	fireEvent.click(trigger);
	return Effect.runPromise(
		Effect.map(
			Effect.promise(() => screen.findByRole("dialog", { name: "Navigation" })),
			(dialog) => ({ dialog, trigger }),
		),
	);
};

describe("mobile drawer", () => {
	it.live("closes on Escape, restores focus, and releases body scrolling", () =>
		Effect.gen(function* () {
			render(<Harness />);
			const { dialog, trigger } = yield* Effect.promise(() => openDrawer());

			expect(document.body.style.overflow).toBe("hidden");
			fireEvent.keyDown(dialog, { key: "Escape" });

			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(trigger)));
			expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
			expect(document.body.style.overflow).toBe("");
		}),
	);

	it.live("passes an axe pass while open", () =>
		Effect.gen(function* () {
			render(<Harness />);
			yield* Effect.promise(() => openDrawer());

			const results = yield* Effect.promise(() =>
				axe(document.body, { rules: { "color-contrast": { enabled: false } } }),
			);

			expect(results.violations.map((violation) => violation.id)).toEqual([]);
		}),
	);

	it.live("contains forward and reverse Tab focus", () =>
		Effect.gen(function* () {
			render(<Harness />);
			const { dialog } = yield* Effect.promise(() => openDrawer());
			const first = screen.getByRole("button", { name: "Media workspace, media" });
			const last = screen.getByRole("link", { name: "Open settings" });

			first.focus();
			fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
			expect(document.activeElement).toBe(last);

			last.focus();
			fireEvent.keyDown(dialog, { key: "Tab" });
			expect(document.activeElement).toBe(first);
		}),
	);

	it("stays mounted off its route until the closing panel settles off screen", () => {
		const progress = motionValue(0);
		render(<Harness hasDrawer={false} progress={progress} />);

		expect(screen.queryByTestId("mobile-drawer")).toBeNull();

		act(() => progress.set(0.5));
		expect(screen.getByTestId("mobile-drawer")).toBeTruthy();

		act(() => progress.set(0));
		expect(screen.queryByTestId("mobile-drawer")).toBeNull();
	});

	it.live("closes on scrim click", () =>
		Effect.gen(function* () {
			render(<Harness />);
			const { trigger } = yield* Effect.promise(() => openDrawer());

			fireEvent.click(screen.getByTestId("drawer-scrim"));

			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(trigger)));
			expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
		}),
	);

	it.live("resets its workspace menu when the drawer closes", () =>
		Effect.gen(function* () {
			render(<Harness />);
			yield* Effect.promise(() => openDrawer());
			fireEvent.click(screen.getByRole("button", { name: "Media workspace, media" }));
			expect(screen.getByRole("menu", { name: "Workspaces" })).toBeTruthy();

			fireEvent.click(screen.getByTestId("drawer-scrim"));
			yield* Effect.promise(() => openDrawer());

			expect(screen.queryByRole("menu", { name: "Workspaces" })).toBeNull();
		}),
	);

	it.live("releases body scrolling before it reports the close", () =>
		Effect.gen(function* () {
			const overflow: Array<string> = [];
			render(<Harness onClose={() => overflow.push(document.body.style.overflow)} />);
			yield* Effect.promise(() => openDrawer());

			expect(document.body.style.overflow).toBe("hidden");
			fireEvent.click(screen.getByRole("link", { name: "Home" }));

			expect(overflow).toEqual([""]);
		}),
	);

	it.live("closes before Home and workspace navigation", () =>
		Effect.gen(function* () {
			let homeOpen: boolean | null = null;
			let selected: { readonly open: boolean; readonly slug: string } | null = null;
			const journal = workspace({
				sortOrder: 1,
				name: "Journal",
				slug: "journal",
				pluginId: "plugin-journal",
				sourceHash: "source-journal",
				installationId: "installation-journal",
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
			yield* Effect.promise(() => openDrawer());

			fireEvent.click(screen.getByRole("link", { name: "Home" }));
			yield* Effect.promise(() => waitFor(() => expect(homeOpen).toBe(false)));

			yield* Effect.promise(() => openDrawer());
			fireEvent.click(screen.getByRole("button", { name: "Media workspace, media" }));
			fireEvent.click(screen.getByRole("menuitemradio", { name: "Switch to Journal workspace" }));

			yield* Effect.promise(() =>
				waitFor(() => expect(selected).toEqual({ open: false, slug: "journal" })),
			);
		}),
	);
});
