import {
	Outlet,
	useLocation,
	useNavigate,
	useRouteContext,
	useRouter,
} from "@tanstack/react-router";
import { Effect } from "effect";
import { motion, useMotionValue, useTransform } from "motion/react";
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";

import { AuthService } from "#/modules/auth/service";
import { useDesktopEffect, useIsDesktop } from "#/modules/navigation/breakpoint";
import { DesktopSidebar } from "#/modules/navigation/desktop-sidebar";
import { CONTENT_SHIFT } from "#/modules/navigation/drawer-metrics";
import { EdgeGesture } from "#/modules/navigation/edge-gesture";
import { isSettingsPath, resolveEdge, type EdgeResolution } from "#/modules/navigation/edge-intent";
import { impactLight } from "#/modules/navigation/haptics";
import { historyEntry } from "#/modules/navigation/history-entry";
import { MobileDrawer } from "#/modules/navigation/mobile-drawer";
import { MobileHeader } from "#/modules/navigation/mobile-header";
import {
	isWorkspaceRoot,
	resolvePluginRouteWorkspace,
	resolveRememberedWorkspace,
} from "#/modules/navigation/workspace-state";
import { usePluginCatalog } from "#/modules/plugins/catalog-provider";
import type { PluginHeaderPublication } from "#/modules/plugins/plugin-host";
import { ClientStorage } from "#/persistence/storage";

const RememberedWorkspaceContext = createContext<string | null | undefined>(undefined);

type PluginHeaderState = PluginHeaderPublication & { readonly owner: string };

type PluginHeaderController = {
	readonly clear: (owner: string) => void;
	readonly publish: (owner: string, header: PluginHeaderPublication) => void;
};

const PluginHeaderContext = createContext<PluginHeaderController | undefined>(undefined);

const EdgeContext = createContext<EdgeResolution | undefined>(undefined);

export const useEdge = () => {
	const edge = useContext(EdgeContext);
	if (edge === undefined) {
		throw new Error("useEdge must be used inside AuthenticatedShell");
	}
	return edge;
};

export const useRememberedWorkspaceSlug = () => {
	const slug = useContext(RememberedWorkspaceContext);
	if (slug === undefined) {
		throw new Error("useRememberedWorkspaceSlug must be used inside AuthenticatedShell");
	}
	return slug;
};

export const usePluginHeader = () => {
	const header = useContext(PluginHeaderContext);
	if (header === undefined) {
		throw new Error("usePluginHeader must be used inside AuthenticatedShell");
	}
	return header;
};

export function AuthenticatedShell(props: {
	readonly isPro: boolean;
	readonly initialRememberedSlug: string | null;
}) {
	const router = useRouter();
	const drawerId = useId();
	const navigate = useNavigate();
	const { pathname, state } = useLocation();
	const isDesktop = useIsDesktop();
	const { catalog } = usePluginCatalog();
	const progress = useMotionValue(0);
	const contentShift = useTransform(progress, [0, 1], [0, CONTENT_SHIFT]);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const { backInterceptors, runtime, scope, server } = useRouteContext({ from: "/_authenticated" });
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [pluginHeader, setPluginHeader] = useState<PluginHeaderState | null>(null);
	const [rememberedSlug, setRememberedSlug] = useState(props.initialRememberedSlug);
	const settingsActive = isSettingsPath(pathname);
	const routeSlug = pathname.split("/")[1] ?? "";
	const routeWorkspace = resolvePluginRouteWorkspace(catalog, routeSlug);
	const current = resolveRememberedWorkspace(catalog, rememberedSlug);
	const homeActive = isWorkspaceRoot(pathname, current);
	const entry = historyEntry(state);
	const pluginTitle =
		pluginHeader?.owner === routeSlug &&
		pluginHeader.index === entry.index &&
		pluginHeader.key === entry.key
			? pluginHeader.title
			: null;
	const session = runtime.runSync(AuthService).session(server);
	const selectWorkspace = async (slug: string) => {
		impactLight();
		await runtime.runPromise(
			Effect.flatMap(ClientStorage, (storage) => storage.setLastWorkspace(scope, slug)),
		);
		setRememberedSlug(slug);
		await navigate({ replace: true, to: "/$pluginSlug", params: { pluginSlug: slug } });
	};
	const header = useMemo<PluginHeaderController>(
		() => ({
			publish: (owner, publication) => setPluginHeader({ owner, ...publication }),
			clear: (owner) =>
				setPluginHeader((currentHeader) => (currentHeader?.owner === owner ? null : currentHeader)),
		}),
		[],
	);

	const edge = resolveEdge({
		pathname,
		isDesktop,
		canGoBack: router.history.canGoBack(),
		atRoot: isWorkspaceRoot(pathname, routeWorkspace),
		hasPluginDocument: !settingsActive && routeWorkspace !== null,
	});

	useEffect(() => {
		if (!drawerOpen) {
			return undefined;
		}
		return backInterceptors.register(() => {
			setDrawerOpen(false);
			return true;
		});
	}, [backInterceptors, drawerOpen]);
	useEffect(() => {
		if (settingsActive) {
			setDrawerOpen(false);
		}
	}, [settingsActive]);
	useDesktopEffect(() => setDrawerOpen(false));

	return (
		<div data-testid="authenticated-shell" className="flex h-dvh min-h-0 flex-col md:flex-row">
			<DesktopSidebar
				current={current}
				catalog={catalog}
				session={session}
				isPro={props.isPro}
				activeHome={homeActive}
				activeSettings={settingsActive}
				onSelectWorkspace={selectWorkspace}
				onNavigateSettings={() => navigate({ href: "/settings" })}
			/>
			<EdgeGesture
				edge={edge}
				progress={progress}
				isOpen={drawerOpen}
				onBack={() => router.history.back()}
				onOpenChange={(open) => setDrawerOpen(open)}
			/>
			{!settingsActive && (
				<MobileHeader
					drawerId={drawerId}
					isOpen={drawerOpen}
					intent={edge.intent}
					triggerRef={triggerRef}
					onBack={() => router.history.back()}
					onOpen={() => setDrawerOpen(true)}
					title={pluginTitle ?? current?.name ?? "No workspace"}
				/>
			)}
			<MobileDrawer
				current={current}
				catalog={catalog}
				session={session}
				progress={progress}
				isPro={props.isPro}
				drawerId={drawerId}
				isOpen={drawerOpen}
				triggerRef={triggerRef}
				activeHome={homeActive}
				hasDrawer={!settingsActive}
				activeSettings={settingsActive}
				onSelectWorkspace={selectWorkspace}
				onClose={() => setDrawerOpen(false)}
				onNavigateSettings={() => navigate({ href: "/settings" })}
				onNavigateHome={() =>
					current === null
						? undefined
						: navigate({ to: "/$pluginSlug", params: { pluginSlug: current.slug } })
				}
			/>
			<RememberedWorkspaceContext value={rememberedSlug}>
				<PluginHeaderContext value={header}>
					<EdgeContext value={edge}>
						<motion.div
							style={{ x: contentShift }}
							data-testid="shell-content"
							className="min-h-0 min-w-0 flex-1 overflow-hidden"
						>
							<Outlet />
						</motion.div>
					</EdgeContext>
				</PluginHeaderContext>
			</RememberedWorkspaceContext>
		</div>
	);
}
