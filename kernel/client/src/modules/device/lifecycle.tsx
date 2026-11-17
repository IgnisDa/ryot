import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import type { PluginNavigationTarget } from "@ryot-app/plugin-client-contract";
import { Button } from "@ryot-app/plugin-ui-sdk";
import type { ManagedRuntime } from "effect";
import { useEffect, useEffectEvent, useLayoutEffect, useSyncExternalStore } from "react";

import { type ApiScope, apiScopeKey } from "#/api/scope";
import { DeviceService } from "#/modules/device/service";

type DeviceRuntime = ManagedRuntime.ManagedRuntime<DeviceService, never>;

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

export function DeviceLifecycle(props: { readonly runtime: DeviceRuntime }) {
	const t = useT();
	const audible = t(kernelMessage("client.device.alert-channel.audible"));
	const silent = t(kernelMessage("client.device.alert-channel.silent"));
	useEffect(() => {
		const service = props.runtime.runSync(DeviceService);
		props.runtime.runFork(service.start);
		return () => {
			props.runtime.runFork(service.stop);
		};
	}, [props.runtime]);
	useEffect(() => {
		props.runtime.runFork(
			props.runtime.runSync(DeviceService).nameAlertChannels({ silent, audible }),
		);
	}, [audible, props.runtime, silent]);
	return null;
}

export function ReturnShortcutBar(props: {
	readonly scope: ApiScope;
	readonly runtime: DeviceRuntime;
	readonly safeAreaBottom: number;
	readonly onNavigate: (target: PluginNavigationTarget) => void;
	readonly isCurrent: (target: PluginNavigationTarget) => boolean;
}) {
	const t = useT();
	const service = props.runtime.runSync(DeviceService);
	const shortcuts = useSyncExternalStore(service.subscribe, service.shortcuts, service.shortcuts);
	const scoped = shortcuts.filter(
		(shortcut) => shortcut.scope === apiScopeKey(props.scope) && !props.isCurrent(shortcut.target),
	);
	return scoped.length === 0 ? null : (
		<aside
			style={{ paddingBottom: Math.max(8, props.safeAreaBottom) }}
			aria-label={t(kernelMessage("client.device.return-shortcuts"))}
			className="flex shrink-0 flex-wrap justify-center gap-2 border-t border-border bg-bg px-4 py-2"
		>
			{scoped.map((shortcut) => (
				<Button
					type="button"
					variant="secondary"
					key={shortcut.installationId}
					onClick={() => props.onNavigate(shortcut.target)}
				>
					{t(shortcut.label)}
				</Button>
			))}
		</aside>
	);
}
