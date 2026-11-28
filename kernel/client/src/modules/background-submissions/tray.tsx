import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
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

const detail = (
	entry: BackgroundSubmissionEntry,
	t: (message: Message) => Text,
): Text | undefined => {
	const { state } = entry;
	if (
		state.status !== "failed" ||
		state.reason === "operation-failed" ||
		state.reason === "page-write-access-required"
	) {
		return undefined;
	}
	if (state.reason === "operation-rejected") {
		return t(state.message);
	}
	if (state.reason === "app-updated") {
		return t(
			entry.transportSeen
				? kernelMessage("client.background-submissions.reload-may-have-saved")
				: kernelMessage("client.background-submissions.reload-not-saved"),
		);
	}
	return t(kernelMessage("client.background-submissions.retry-may-have-saved"));
};

const tones = {
	failed: "error",
	pending: "pending",
	succeeded: "success",
} as const satisfies Record<
	BackgroundSubmissionEntry["state"]["status"],
	ActivityTrayEntry["tone"]
>;

export function BackgroundSubmissionTrayView(props: {
	readonly compact: boolean;
	readonly onReload: () => void;
	readonly safeAreaBottom: number;
	readonly catalog: PluginClientCatalog;
	readonly entries: readonly ActivityTrayEntry[];
}) {
	const tray = useBackgroundSubmissionTray();
	return tray === null ? null : <TrayEntries {...props} tray={tray} />;
}

export function backgroundSubmissionTrayEntry(options: {
	readonly onReload: () => void;
	readonly catalog: PluginClientCatalog;
	readonly t: (message: Message) => Text;
	readonly tray: BackgroundSubmissionTray;
	readonly entry: BackgroundSubmissionEntry;
}): ActivityTrayEntry {
	const { tray, entry, catalog } = options;
	const { state } = entry;
	const installed = catalog.some(({ installationId }) => installationId === entry.installationId);
	let action: ActivityTrayEntry["action"];
	if (state.status === "failed" && state.reason === "app-updated") {
		action = { onClick: options.onReload, label: options.t(kernelMessage("common.action.reload")) };
	} else if (isRetryable(state) && installed) {
		action = {
			onClick: () => tray.retry(entry.id, catalog),
			label: options.t(kernelMessage("common.action.retry")),
		};
	}
	return {
		action,
		id: entry.id,
		title: options.t(entry.label),
		tone: tones[entry.state.status],
		detail: detail(entry, options.t),
		source: options.t(entry.pluginName),
		status: options.t(backgroundSubmissionStatus(entry)),
		onDismiss: state.status === "pending" ? undefined : () => tray.dismiss(entry.id),
	};
}

function TrayEntries(props: {
	readonly compact: boolean;
	readonly onReload: () => void;
	readonly safeAreaBottom: number;
	readonly catalog: PluginClientCatalog;
	readonly tray: BackgroundSubmissionTray;
	readonly entries: readonly ActivityTrayEntry[];
}) {
	const { tray } = props;
	const t = useT();
	const snapshot = useSyncExternalStore(tray.subscribe, tray.getSnapshot, tray.getSnapshot);
	return (
		<ActivityTray
			compact={props.compact}
			safeAreaBottom={props.safeAreaBottom}
			dismissIcon={<AppIcon name="x" size={14} />}
			label={t(kernelMessage("client.background-submissions.tray-label"))}
			announcement={snapshot.announcement === undefined ? "" : t(snapshot.announcement)}
			entries={[
				...props.entries,
				...snapshot.entries.map((entry) =>
					backgroundSubmissionTrayEntry({
						t,
						tray,
						entry,
						catalog: props.catalog,
						onReload: props.onReload,
					}),
				),
			]}
		/>
	);
}
