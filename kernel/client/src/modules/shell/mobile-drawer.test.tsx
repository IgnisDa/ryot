import { describe, expect } from "bun:test";

import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { it } from "@voila.dev/effect-bun-test";
import axe from "axe-core";
import { Effect } from "effect";
import { useRef, useState } from "react";

import type { AuthSessionStore } from "#/modules/auth/service";
import {
	testI18nWrapper,
	testMessage,
	testMessageCatalog,
} from "#/modules/i18n/provider.test-support";
import type { WorkspaceTarget } from "#/modules/navigation/workspace-state";
import { MobileDrawer } from "#/modules/shell/mobile-drawer";
import type { SidebarSections } from "#/modules/shell/sidebar-sections";

const wrapper = testI18nWrapper([testMessageCatalog("Fixture", "Journal")]);

const workspace = (
	overrides: Partial<PluginClientCatalogEntry> = {},
): PluginClientCatalogEntry => ({
	icon: "film",
	sortOrder: 0,
	health: "ready",
	isHidden: false,
	clientApiVersion: 1,
	clientEntities: null,
	assistantStarters: null,
	name: testMessage("Fixture"),
	contentHash: "source-fixture",
	installationId: "installation-fixture",
	...overrides,
	scope: overrides.scope ?? "system",
	homeSavedView: overrides.homeSavedView ?? null,
	packageId: overrides.packageId ?? PluginPackageId.make("ryot/fixture"),
	pluginId:
		overrides.pluginId ??
		PluginId.make(`plugin-${overrides.packageId?.split("/")[1] ?? "fixture"}`),
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
			reference: null,
			isHidden: false,
			packageId: null,
			pluginInstallationId: null,
		},
	],
};

const navigation: NavigationData = { savedViews: [], collections: [] };

type HarnessProps = {
	readonly hasDrawer?: boolean;
	readonly onClose?: () => void;
	readonly onNavigateHome?: () => void;
	readonly catalog?: PluginClientCatalog;
	readonly onSelectWorkspace?: (workspace: WorkspaceTarget) => void;
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
				activeKey={null}
				session={session}
				current={current}
				activeHome={true}
				sections={sections}
				drawerId="test-drawer"
				activeSettings={false}
				navigation={navigation}
				triggerRef={triggerRef}
				onCustomize={() => undefined}
				onOpenSearch={() => undefined}
				onOpen={() => setIsOpen(true)}
				onNavigateItem={() => undefined}
				onCreateCollection={() => undefined}
				onNavigateSettings={() => undefined}
				catalog={props.catalog ?? [current]}
				swipeToOpen={props.hasDrawer ?? true}
				onNavigateHome={() => props.onNavigateHome?.()}
				onSelectWorkspace={(target) => props.onSelectWorkspace?.(target)}
				assistant={{ attention: 0, mood: "idle", onOpen: () => undefined }}
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
	it.live(
		"closes on Escape, restores focus, and releases body scrolling",
		() =>
			Effect.gen(function* () {
				render(<Harness />, { wrapper: wrapper });
				const { dialog, trigger } = yield* Effect.promise(() => openDrawer());

				yield* Effect.promise(() =>
					waitFor(() => expect(document.body.style.overflowY).toBe("hidden")),
				);
				fireEvent.keyDown(dialog, { key: "Escape" });

				yield* Effect.promise(() =>
					waitFor(() => expect(document.activeElement === trigger).toBe(true)),
				);
				expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
				yield* Effect.promise(() => waitFor(() => expect(document.body.style.overflowY).toBe("")));
			}),
		testTimeout,
	);

	it.live(
		"passes an axe pass while open",
		() =>
			Effect.gen(function* () {
				render(<Harness />, { wrapper: wrapper });
				yield* Effect.promise(() => openDrawer());

				const results = yield* Effect.promise(() =>
					axe.run(document.body, { rules: { "color-contrast": { enabled: false } } }),
				);

				expect(results.violations.map((violation) => violation.id)).toEqual([]);
			}),
		testTimeout,
	);

	it("only enables the drawer swipe on routes with drawer intent", () => {
		const view = render(<Harness hasDrawer={false} />, { wrapper });
		expect(screen.queryByTestId("edge-gesture")).toBeNull();
		view.rerender(<Harness />);
		expect(screen.getByTestId("edge-gesture")).toBeTruthy();
	});

	it.live(
		"resets its workspace menu when the drawer closes",
		() =>
			Effect.gen(function* () {
				render(<Harness />, { wrapper: wrapper });
				yield* Effect.promise(() => openDrawer());
				fireEvent.click(screen.getByRole("button", { name: /^Fixture workspace,/ }));
				expect(screen.getByRole("menu", { name: "Workspaces" })).toBeTruthy();

				fireEvent.keyDown(screen.getByRole("menu", { name: "Workspaces" }), { key: "Escape" });
				fireEvent.keyDown(screen.getByRole("dialog", { name: "Navigation" }), { key: "Escape" });
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull()),
				);
				yield* Effect.promise(() => openDrawer());

				expect(screen.queryByRole("menu", { name: "Workspaces" })).toBeNull();
			}),
		testTimeout,
	);

	it.live(
		"closes before Home and workspace navigation",
		() =>
			Effect.gen(function* () {
				let homeOpen: null | boolean = null;
				let selected: null | { readonly slug: string; readonly open: boolean } = null;
				const journal = workspace({
					sortOrder: 1,
					name: testMessage("Journal"),
					contentHash: "source-journal",
					installationId: "installation-journal",
					pluginId: PluginId.make("plugin-journal"),
					packageId: PluginPackageId.make("test/journal"),
				});
				render(
					<Harness
						catalog={[workspace(), journal]}
						onNavigateHome={() => {
							homeOpen =
								screen.queryByRole("dialog", { name: "Navigation" }) !== null ||
								document.body.style.overflow === "hidden";
						}}
						onSelectWorkspace={({ pluginId }) => {
							selected = {
								slug: pluginId,
								open:
									screen.queryByRole("dialog", { name: "Navigation" }) !== null ||
									document.body.style.overflow === "hidden",
							};
						}}
					/>,
					{ wrapper: wrapper },
				);
				yield* Effect.promise(() => openDrawer());

				fireEvent.click(screen.getByRole("link", { name: "Home" }));
				yield* Effect.promise(() => waitFor(() => expect(homeOpen).toBe(false)));

				yield* Effect.promise(() => openDrawer());
				fireEvent.click(screen.getByRole("button", { name: /^Fixture workspace,/ }));
				fireEvent.click(screen.getByRole("menuitemradio", { name: /^Switch to Journal / }));

				yield* Effect.promise(() =>
					waitFor(() => expect(selected).toEqual({ open: false, slug: "plugin-journal" })),
				);
			}),
		testTimeout,
	);
});
