import { ActivityTray, type ActivityTrayEntry } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { Effect } from "effect";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

import type { ApiScope } from "#/api/scope";
import {
	type BackgroundSubmissionEntry,
	BackgroundSubmissionService,
	backgroundSubmissionStatus,
	type BackgroundSubmissionTray,
	isRetryable,
} from "#/modules/background-submissions/service";
import type { ClientRuntime } from "#/runtime";

const BackgroundSubmissionsContext = createContext<null | BackgroundSubmissionTray>(null);

export const useBackgroundSubmissionTray = () => useContext(BackgroundSubmissionsContext);

export function BackgroundSubmissionsProvider(props: {
	readonly scope: ApiScope;
	readonly children: ReactNode;
	readonly runtime: ClientRuntime;
	readonly onSucceeded: () => void;
}) {
	const { userId, serverUrl } = props.scope;
	const { runtime } = props;
	const onSucceeded = useRef(props.onSucceeded);
	useLayoutEffect(() => {
		onSucceeded.current = props.onSucceeded;
	});
	const [tray, setTray] = useState<null | BackgroundSubmissionTray>(null);
	useEffect(() => {
		const opened = runtime.runSync(
			Effect.flatMap(BackgroundSubmissionService, (service) =>
				service.open({ scope: { userId, serverUrl }, onSucceeded: () => onSucceeded.current() }),
			),
		);
		setTray(opened);
		return () => {
			opened.dispose();
			setTray(null);
		};
	}, [runtime, serverUrl, userId]);
	return <BackgroundSubmissionsContext value={tray}>{props.children}</BackgroundSubmissionsContext>;
}

const detail = (entry: BackgroundSubmissionEntry): string | undefined => {
	const { state } = entry;
	if (state.status === "incomplete") {
		return state.count === undefined
			? "Retry to finish."
			: `${state.count} saved so far. Retry to finish.`;
	}
	if (state.status !== "failed" || state.reason === "operation-failed") {
		return undefined;
	}
	if (state.reason === "operation-rejected") {
		return state.message;
	}
	if (state.reason === "app-updated") {
		return entry.transportSeen
			? "It may have been saved. Reload to see the latest version."
			: "It was not saved. Reload, then try again.";
	}
	return "It may have been saved. Retrying won't save it twice.";
};

const tones = {
	failed: "error",
	pending: "pending",
	succeeded: "success",
	incomplete: "warning",
} as const satisfies Record<
	BackgroundSubmissionEntry["state"]["status"],
	ActivityTrayEntry["tone"]
>;

export function BackgroundSubmissionTrayView(props: {
	readonly compact: boolean;
	readonly onReload: () => void;
	readonly safeAreaBottom: number;
	readonly catalog: PluginClientCatalog;
}) {
	const tray = useBackgroundSubmissionTray();
	return tray === null ? null : <TrayEntries {...props} tray={tray} />;
}

export function backgroundSubmissionTrayEntry(options: {
	readonly onReload: () => void;
	readonly catalog: PluginClientCatalog;
	readonly tray: BackgroundSubmissionTray;
	readonly entry: BackgroundSubmissionEntry;
}): ActivityTrayEntry {
	const { tray, entry, catalog } = options;
	const { state } = entry;
	const installed = catalog.some(({ installationId }) => installationId === entry.installationId);
	let action: ActivityTrayEntry["action"];
	if (state.status === "failed" && state.reason === "app-updated") {
		action = { label: "Reload", onClick: options.onReload };
	} else if (isRetryable(state) && installed) {
		action = { label: "Retry", onClick: () => tray.retry(entry.id, catalog) };
	}
	return {
		action,
		id: entry.id,
		title: entry.label,
		detail: detail(entry),
		source: entry.pluginName,
		tone: tones[entry.state.status],
		status: backgroundSubmissionStatus(entry),
		onDismiss: state.status === "pending" ? undefined : () => tray.dismiss(entry.id),
	};
}

function TrayEntries(props: {
	readonly compact: boolean;
	readonly onReload: () => void;
	readonly safeAreaBottom: number;
	readonly catalog: PluginClientCatalog;
	readonly tray: BackgroundSubmissionTray;
}) {
	const { tray } = props;
	const snapshot = useSyncExternalStore(tray.subscribe, tray.getSnapshot, tray.getSnapshot);
	return (
		<ActivityTray
			compact={props.compact}
			label="Background activity"
			announcement={snapshot.announcement}
			safeAreaBottom={props.safeAreaBottom}
			dismissIcon={<AppIcon name="x" size={14} />}
			entries={snapshot.entries.map((entry) =>
				backgroundSubmissionTrayEntry({
					tray,
					entry,
					catalog: props.catalog,
					onReload: props.onReload,
				}),
			)}
		/>
	);
}
