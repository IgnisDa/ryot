import { Button } from "@ryot-app/client-ui-sdk";
import { DataTable, type DataTableColumn } from "@ryot-app/client-ui-sdk/table";
import { Cause, Effect, Exit, Option } from "effect";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { AdminApiError } from "#/api/admin";
import { FileDownloadError } from "#/modules/downloads/file";
import { isUnauthorizedCause } from "#/modules/god-mode/errors";
import type { GodModeLogs } from "#/modules/god-mode/service";

const PAGE_SIZE = 25;

type LogFile = GodModeLogs["files"][number];
type OperationResult<A> = Effect.Effect<Exit.Exit<A, unknown>>;
type Page =
	| { readonly after: string | undefined; readonly state: "loading" | "error" }
	| { readonly after: string | undefined; readonly state: "loaded"; readonly value: GodModeLogs };

const logColumns: ReadonlyArray<DataTableColumn<LogFile>> = [
	{ id: "file", header: "Log file", headerClassName: "px-3 py-3 font-semibold" },
	{ id: "type", header: "Type", headerClassName: "px-3 py-3 font-semibold" },
	{ id: "size", header: "Size", headerClassName: "px-3 py-3 font-semibold" },
	{ id: "modified", header: "Modified", headerClassName: "px-3 py-3 font-semibold" },
	{ id: "actions", header: "Actions", headerClassName: "px-3 py-3 text-right font-semibold" },
];

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
	readonly load: (after: string | undefined, limit: number) => OperationResult<GodModeLogs>;
	readonly download: (file?: LogFile) => OperationResult<void>;
}) {
	const [pages, setPages] = useState<ReadonlyArray<Page>>([{ after: undefined, state: "loading" }]);
	const [downloadError, setDownloadError] = useState<string>();
	const [downloading, setDownloading] = useState<string>();
	const generation = useRef(0);
	const downloadBusy = useRef(false);
	const controller = useRef<AbortController>(null);

	const applyPage = (
		after: string | undefined,
		version: number,
		signal: AbortSignal,
		result: Exit.Exit<GodModeLogs, unknown>,
	) => {
		if (signal.aborted || generation.current !== version) {
			return;
		}
		if (Exit.isFailure(result) && isUnauthorizedCause(result.cause)) {
			props.unauthorized();
			return;
		}
		setPages((current) =>
			current.map((page) => {
				if (page.after !== after) {
					return page;
				}
				return Exit.isSuccess(result)
					? { after, state: "loaded", value: result.value }
					: { after, state: "error" };
			}),
		);
	};
	const loadPage = (after: string | undefined, version: number, signal: AbortSignal) =>
		Effect.runFork(
			props
				.load(after, PAGE_SIZE)
				.pipe(Effect.map((result) => applyPage(after, version, signal, result))),
			{ signal },
		);
	const refresh = () => {
		if (downloadBusy.current) {
			return;
		}
		const version = generation.current + 1;
		generation.current = version;
		controller.current?.abort();
		const next = new AbortController();
		controller.current = next;
		setPages([{ after: undefined, state: "loading" }]);
		setDownloadError(undefined);
		loadPage(undefined, version, next.signal);
	};
	const initialLoad = useEffectEvent(refresh);
	useEffect(() => {
		initialLoad();
		return () => {
			generation.current += 1;
			controller.current?.abort();
		};
	}, []);

	const requestPage = (after: string | undefined) => {
		const signal = controller.current?.signal;
		if (signal !== undefined) {
			loadPage(after, generation.current, signal);
		}
	};
	const retry = (after: string | undefined) => {
		setPages((current) =>
			current.map((page) => (page.after === after ? { after, state: "loading" } : page)),
		);
		requestPage(after);
	};

	const loadedPages = pages.filter(
		(page): page is Extract<Page, { readonly state: "loaded" }> => page.state === "loaded",
	);
	const files = loadedPages.flatMap((page) => page.value.files);
	const first = pages[0];
	const last = pages.at(-1);
	const loading = pages.some((page) => page.state === "loading");
	const loadMore = () => {
		if (last?.state !== "loaded" || last.value.pageInfo.nextCursor === null) {
			return;
		}
		const after = last.value.pageInfo.nextCursor;
		setPages((current) => [...current, { after, state: "loading" }]);
		requestPage(after);
	};
	const download = (file?: LogFile) => {
		if (downloadBusy.current || loading) {
			return;
		}
		downloadBusy.current = true;
		setDownloading(file?.id ?? "all");
		setDownloadError(undefined);
		const signal = controller.current?.signal;
		Effect.runFork(
			props.download(file).pipe(
				Effect.map((result) => {
					if (signal?.aborted) {
						return;
					}
					downloadBusy.current = false;
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
					disabled={loading || files.length === 0 || downloading !== undefined}
				>
					{downloading === "all" ? "Downloading all logs..." : "Download all logs"}
				</Button>
			</div>
			{first.state === "loading" && <p role="status">Loading server logs...</p>}
			{first.state === "error" && (
				<p role="alert" className="text-danger">
					Could not load the server logs. Check the server and try again.
				</p>
			)}
			{downloadError && (
				<p role="alert" className="text-danger">
					{downloadError}
				</p>
			)}
			{first.state === "loaded" && files.length === 0 && (
				<p className="py-8 text-center text-sm text-text-muted">No server logs available.</p>
			)}
			{files.length > 0 && (
				<div className="mt-5 overflow-x-auto rounded-xl border border-border">
					<DataTable
						data={files}
						columns={logColumns}
						getRowId={(file) => file.id}
						className="w-full border-collapse text-left text-sm"
						headerClassName="border-b border-border bg-surface-2 text-xs text-text-muted"
						renderRow={(file) => (
							<LogTableRow
								file={file}
								loading={loading}
								onDownload={download}
								downloading={downloading}
							/>
						)}
					/>
				</div>
			)}
			{last?.state === "loading" && loadedPages.length > 0 && (
				<p role="status" className="mt-4 text-center text-sm text-text-muted">
					Loading more logs...
				</p>
			)}
			{last?.state === "error" && loadedPages.length > 0 && (
				<div className="mt-5 grid justify-items-center gap-3">
					<p role="alert" className="text-sm text-danger">
						Could not load more server logs. Check the server and try again.
					</p>
					<Button type="button" variant="secondary" onClick={() => retry(last.after)}>
						Retry loading logs
					</Button>
				</div>
			)}
			{last?.state === "loaded" && last.value.pageInfo.nextCursor !== null && (
				<div className="mt-5 flex justify-center">
					<Button
						type="button"
						onClick={loadMore}
						variant="secondary"
						disabled={downloading !== undefined}
					>
						Load more logs
					</Button>
				</div>
			)}
		</section>
	);
}

function LogTableRow(props: {
	readonly file: LogFile;
	readonly loading: boolean;
	readonly onDownload: (file: LogFile) => void;
	readonly downloading: string | undefined;
}) {
	return (
		<tr className="border-b border-border last:border-b-0">
			<td className="min-w-56 px-3 py-4 font-mono text-sm">
				<span className="break-all">{props.file.name}</span>
			</td>
			<td className="px-3 py-4">
				<span
					className={
						props.file.active
							? "inline-flex rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success"
							: "inline-flex rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text-muted"
					}
				>
					{props.file.active ? "Active" : "Compressed"}
				</span>
			</td>
			<td className="px-3 py-4 whitespace-nowrap text-text-muted">
				{props.file.size.toLocaleString()} bytes
			</td>
			<td className="px-3 py-4 whitespace-nowrap text-text-muted">
				{new Date(props.file.modifiedAt).toLocaleString()}
			</td>
			<td className="px-3 py-3 text-right">
				<Button
					type="button"
					variant="secondary"
					aria-label={`Download ${props.file.name}`}
					onClick={() => props.onDownload(props.file)}
					disabled={props.loading || props.downloading !== undefined}
				>
					{props.downloading === props.file.id ? "Downloading..." : "Download"}
				</Button>
			</td>
		</tr>
	);
}
