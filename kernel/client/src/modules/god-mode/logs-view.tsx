import { Button } from "@ryot-app/client-ui-sdk";
import { Cause, Effect, Exit, Option } from "effect";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { AdminApiError } from "#/api/admin";
import { FileDownloadError } from "#/modules/downloads/file";
import { isUnauthorizedCause } from "#/modules/god-mode/errors";
import type { GodModeLogs } from "#/modules/god-mode/service";

const downloadMessage = (cause: Cause.Cause<unknown>) => {
	const error = Option.getOrUndefined(Cause.findErrorOption(cause));
	return error instanceof AdminApiError &&
		error.cause instanceof FileDownloadError &&
		error.cause.status === 404
		? "The log file is no longer available. Refresh the list and try again."
		: "Could not download the logs. Check the server and try again.";
};

export function ServerLogsView(props: {
	readonly unauthorized: () => void;
	readonly load: () => Effect.Effect<Exit.Exit<GodModeLogs, unknown>>;
	readonly download: (
		file?: GodModeLogs["files"][number],
	) => Effect.Effect<Exit.Exit<void, unknown>>;
}) {
	const [files, setFiles] = useState<GodModeLogs["files"]>([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string>();
	const [downloadError, setDownloadError] = useState<string>();
	const [downloading, setDownloading] = useState<string>();
	const busy = useRef(false);
	const controller = useRef<AbortController>(null);
	const refresh = () => {
		if (busy.current) {
			return;
		}
		setLoading(true);
		setLoadError(undefined);
		setDownloadError(undefined);
		controller.current?.abort();
		const next = new AbortController();
		controller.current = next;
		Effect.runFork(
			props.load().pipe(
				Effect.map((result) => {
					if (next.signal.aborted) {
						return;
					}
					setLoading(false);
					if (Exit.isSuccess(result)) {
						setFiles(result.value.files);
					} else if (isUnauthorizedCause(result.cause)) {
						props.unauthorized();
					} else {
						setLoadError("Could not load the server logs. Check the server and try again.");
					}
				}),
			),
			{ signal: next.signal },
		);
	};
	const initialLoad = useEffectEvent(refresh);
	useEffect(() => {
		initialLoad();
		return () => controller.current?.abort();
	}, []);
	const download = (file?: GodModeLogs["files"][number]) => {
		if (busy.current || loading) {
			return;
		}
		busy.current = true;
		setDownloading(file?.id ?? "all");
		setDownloadError(undefined);
		const signal = controller.current?.signal;
		Effect.runFork(
			props.download(file).pipe(
				Effect.map((result) => {
					if (signal?.aborted) {
						return;
					}
					busy.current = false;
					setDownloading(undefined);
					if (Exit.isFailure(result)) {
						if (isUnauthorizedCause(result.cause)) {
							props.unauthorized();
						} else {
							setDownloadError(downloadMessage(result.cause));
						}
					}
				}),
			),
			{ signal },
		);
	};
	return (
		<section className="ui-card w-full" aria-labelledby="server-logs-title">
			<p className="ui-overline">Administration</p>
			<h1 id="server-logs-title" className="font-display text-3xl font-semibold">
				Server logs
			</h1>
			<p className="ui-subtitle">
				Download the active log or retained compressed logs from this server.
			</p>
			<p className="mt-3 text-sm text-text-muted">
				The active log includes messages written when the download starts. Recent messages can take
				about one second to appear.
			</p>
			<div className="my-5 flex flex-wrap gap-3">
				<Button
					type="button"
					onClick={refresh}
					variant="secondary"
					disabled={loading || downloading !== undefined}
				>
					Refresh
				</Button>
				<Button
					type="button"
					variant="primary"
					onClick={() => download()}
					disabled={
						loading || files.length === 0 || loadError !== undefined || downloading !== undefined
					}
				>
					{downloading === "all" ? "Downloading all logs..." : "Download all logs"}
				</Button>
			</div>
			{loading && <p role="status">Loading server logs...</p>}
			{loadError && (
				<p role="alert" className="text-danger">
					{loadError}
				</p>
			)}
			{downloadError && (
				<p role="alert" className="text-danger">
					{downloadError}
				</p>
			)}
			{!loading && loadError === undefined && files.length === 0 && (
				<p>No server logs available.</p>
			)}
			{!loading && loadError === undefined && files.length > 0 && (
				<ul className="divide-y divide-border">
					{files.map((file) => (
						<li key={file.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
							<div className="min-w-0">
								<p className="break-all font-mono text-sm">{file.name}</p>
								<p className="mt-1 text-sm text-text-muted">
									{file.active ? "Active · " : "Compressed · "}
									{file.size.toLocaleString()} bytes · {new Date(file.modifiedAt).toLocaleString()}
								</p>
							</div>
							<Button
								type="button"
								variant="secondary"
								onClick={() => download(file)}
								aria-label={`Download ${file.name}`}
								disabled={downloading !== undefined}
							>
								{downloading === file.id ? "Downloading..." : "Download"}
							</Button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
