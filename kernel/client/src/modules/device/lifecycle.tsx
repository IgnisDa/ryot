import type { PluginNavigationTarget } from "@ryot-app/plugin-client-contract";
import { Button } from "@ryot-app/plugin-ui-sdk";
import type { ManagedRuntime } from "effect";
import { useEffect, useEffectEvent, useLayoutEffect, useSyncExternalStore } from "react";

import { apiScopeKey, type ApiScope } from "#/api/scope";
import { DeviceService } from "#/modules/device/service";

type DeviceRuntime = ManagedRuntime.ManagedRuntime<DeviceService, never>;

export function DeviceLifecycle(props: { readonly runtime: DeviceRuntime }) {
	useEffect(() => {
		const service = props.runtime.runSync(DeviceService);
		props.runtime.runFork(service.start);
		return () => {
			props.runtime.runFork(service.stop);
		};
	}, [props.runtime]);
	return null;
}

export function DeviceScope(props: {
	readonly scope: ApiScope;
	readonly runtime: DeviceRuntime;
	readonly onNavigate: (target: PluginNavigationTarget) => void;
}) {
	const navigate = useEffectEvent(props.onNavigate);
	const { userId, serverUrl } = props.scope;
	useLayoutEffect(() => {
		const service = props.runtime.runSync(DeviceService);
		props.runtime.runFork(service.setScope({ userId, serverUrl }, (target) => navigate(target)));
		return () => {
			props.runtime.runFork(service.setScope(undefined));
		};
	}, [props.runtime, serverUrl, userId]);
	return null;
}

export function ReturnShortcutBar(props: {
	readonly scope: ApiScope;
	readonly runtime: DeviceRuntime;
	readonly safeAreaBottom: number;
	readonly onNavigate: (target: PluginNavigationTarget) => void;
}) {
	const service = props.runtime.runSync(DeviceService);
	const shortcuts = useSyncExternalStore(service.subscribe, service.shortcuts, service.shortcuts);
	const scoped = shortcuts.filter((shortcut) => shortcut.scope === apiScopeKey(props.scope));
	return scoped.length === 0 ? null : (
		<aside
			aria-label="Return shortcuts"
			style={{ paddingBottom: Math.max(8, props.safeAreaBottom) }}
			className="flex shrink-0 flex-wrap justify-center gap-2 border-t border-border bg-surface px-4 py-2"
		>
			{scoped.map((shortcut) => (
				<Button
					type="button"
					variant="secondary"
					key={shortcut.installationId}
					onClick={() => props.onNavigate(shortcut.target)}
				>
					{shortcut.label}
				</Button>
			))}
		</aside>
	);
}
