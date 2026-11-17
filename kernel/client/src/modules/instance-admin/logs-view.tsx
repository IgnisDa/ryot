import type { Message } from "@ryot-app/i18n/message";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { nextPageCursor, paginationItems, usePagination } from "@ryot-app/plugin-client-sdk/react";
import { Button, LoadMoreButton } from "@ryot-app/plugin-ui-sdk";
import { DataTable, type DataTableColumn } from "@ryot-app/plugin-ui-sdk/table";
import { Cause, Effect, Option } from "effect";
import { useRef, useState } from "react";

import { AdminApiError } from "#/api/admin";
import { FileDownloadError } from "#/modules/downloads/file";
import {
	isUnauthorizedCause,
	runAdminAction,
	withAdminAuthorization,
} from "#/modules/instance-admin/errors";
import type { InstanceAdminLogs } from "#/modules/instance-admin/service";
import { useUnmountSignal } from "#/modules/ui/use-unmount-signal";

const PAGE_SIZE = 25;

type LogFile = InstanceAdminLogs["files"][number];

const logColumns = (t: (message: Message) => Text): ReadonlyArray<DataTableColumn<LogFile>> => [
	{
		id: "file",
		headerClassName: "px-3 py-3 font-semibold",
		header: t(kernelMessage("client.instance-admin.logs.column.file")),
	},
	{
		id: "type",
		headerClassName: "px-3 py-3 font-semibold",
		header: t(kernelMessage("client.instance-admin.logs.column.type")),
	},
	{
		id: "size",
		headerClassName: "px-3 py-3 font-semibold",
		header: t(kernelMessage("client.instance-admin.logs.column.size")),
	},
	{
		id: "modified",
		headerClassName: "px-3 py-3 font-semibold",
		header: t(kernelMessage("client.instance-admin.logs.column.modified")),
	},
	{
		id: "actions",
		header: t(kernelMessage("sdk.browser.actions")),
		headerClassName: "px-3 py-3 text-right font-semibold",
	},
];

const downloadMessage = (cause: Cause.Cause<unknown>) => {
	const error = Option.getOrUndefined(Cause.findErrorOption(cause));
	return error instanceof AdminApiError &&
		error.cause instanceof FileDownloadError &&
		error.cause.status === 404
		? kernelMessage("client.instance-admin.logs.download-unavailable")
		: kernelMessage("client.instance-admin.logs.download-failed");
};

export function ServerLogsView(props: {
	readonly unauthorized: () => void;
	readonly download: (file?: LogFile) => Effect.Effect<void, unknown>;
	readonly load: (
		after: string | undefined,
		limit: number,
	) => Effect.Effect<InstanceAdminLogs, unknown>;
}) {
	const t = useT();
	const [downloadError, setDownloadError] = useState<Message>();
	const [downloading, setDownloading] = useState<string>();
	const downloadBusy = useRef(false);
	const unmountSignal = useUnmountSignal();
	const pagination = usePagination<InstanceAdminLogs, string | undefined>({
		initialPageParam: undefined,
		getNextPageParam: nextPageCursor,
		identity: "instance-admin-server-logs",
		load: (after) => withAdminAuthorization(props.load(after, PAGE_SIZE), props.unauthorized),
	});
	const files = paginationItems(
		pagination.pages,
		(page) => page.files,
		(file) => file.id,
	);
	const loading = pagination.isFetching || pagination.isPending;
	const unauthorized = pagination.cause !== null && isUnauthorizedCause(pagination.cause);
	const refresh = () => {
		if (downloadBusy.current) {
			return;
		}
		setDownloadError(undefined);
		pagination.refetch();
	};
	const download = (file?: LogFile) => {
		if (downloadBusy.current || loading) {
			return;
		}
		downloadBusy.current = true;
		setDownloading(file?.id ?? "all");
		setDownloadError(undefined);
		const signal = unmountSignal();
		Effect.runFork(
			runAdminAction({
				signal,
				onSuccess: () => undefined,
				onUnauthorized: props.unauthorized,
				operation: () => props.download(file),
				onFailure: (cause) => setDownloadError(downloadMessage(cause)),
				onSettled: (aborted) => {
					downloadBusy.current = false;
					if (!aborted) {
						setDownloading(undefined);
					}
				},
			}),
			{ signal },
		);
	};

	return (
		<section className="ui-card w-full" aria-labelledby="server-logs-title">
			<p className="ui-overline">{t(kernelMessage("client.settings.section.administration"))}</p>
			<h1 id="server-logs-title" className="font-display text-3xl font-semibold">
				{t(kernelMessage("client.instance-admin.logs.title"))}
			</h1>
			<p className="ui-subtitle">{t(kernelMessage("client.instance-admin.logs.subtitle"))}</p>
			<p className="mt-3 text-sm text-text-muted">
				{t(kernelMessage("client.instance-admin.logs.note"))}
			</p>
			<div className="my-5 flex flex-wrap gap-3">
				<Button
					type="button"
					onClick={refresh}
					variant="secondary"
					disabled={loading || downloading !== undefined}
				>
					{t(kernelMessage("common.action.refresh"))}
				</Button>
				<Button
					type="button"
					variant="primary"
					onClick={() => download()}
					disabled={loading || files.length === 0 || downloading !== undefined}
				>
					{t(
						kernelMessage(
							downloading === "all"
								? "client.instance-admin.logs.downloading-all"
								: "client.instance-admin.logs.download-all",
						),
					)}
				</Button>
			</div>
			{!unauthorized && pagination.isPending && (
				<p role="status">{t(kernelMessage("client.instance-admin.logs.loading"))}</p>
			)}
			{!unauthorized &&
				pagination.errorOperation !== null &&
				pagination.errorOperation !== "append" && (
					<p role="alert" className="text-danger">
						{t(kernelMessage("client.instance-admin.logs.load-failed"))}
					</p>
				)}
			{downloadError && (
				<p role="alert" className="text-danger">
					{t(downloadError)}
				</p>
			)}
			{pagination.pages.length > 0 && files.length === 0 && !loading && (
				<p className="py-8 text-center text-sm text-text-muted">
					{t(kernelMessage("client.instance-admin.logs.empty"))}
				</p>
			)}
			{files.length > 0 && (
				<div className="mt-5 overflow-x-auto rounded-xl border border-border">
					<DataTable
						data={files}
						columns={logColumns(t)}
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
			{pagination.isFetchingNextPage && (
				<p role="status" className="mt-4 text-center text-sm text-text-muted">
					{t(kernelMessage("client.instance-admin.logs.loading-more"))}
				</p>
			)}
			{!unauthorized && pagination.errorOperation === "append" && (
				<div className="mt-5 grid justify-items-center gap-3">
					<p role="alert" className="text-sm text-danger">
						{t(kernelMessage("client.instance-admin.logs.load-more-failed"))}
					</p>
					<Button type="button" variant="secondary" onClick={pagination.retry}>
						{t(kernelMessage("client.instance-admin.logs.retry"))}
					</Button>
				</div>
			)}
			{pagination.hasNextPage && pagination.errorOperation !== "append" && (
				<div className="mt-5 flex justify-center">
					<LoadMoreButton
						type="button"
						onClick={pagination.fetchNextPage}
						isFetchingNextPage={pagination.isFetchingNextPage}
						label={t(kernelMessage("client.instance-admin.logs.load-more"))}
						loadingLabel={t(kernelMessage("client.instance-admin.logs.loading-more"))}
						disabled={
							downloading !== undefined || (pagination.isFetching && !pagination.isFetchingNextPage)
						}
					/>
				</div>
			)}
		</section>
	);
}

function LogTableRow(props: {
	readonly file: LogFile;
	readonly loading: boolean;
	readonly downloading: string | undefined;
	readonly onDownload: (file: LogFile) => void;
}) {
	const t = useT();
	const formatters = useFormatters();
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
					{t(
						kernelMessage(
							props.file.active
								? "client.instance-admin.logs.type.active"
								: "client.instance-admin.logs.type.compressed",
						),
					)}
				</span>
			</td>
			<td className="px-3 py-4 whitespace-nowrap text-text-muted">
				{t(kernelMessage("client.instance-admin.logs.size", { size: props.file.size }))}
			</td>
			<td className="px-3 py-4 whitespace-nowrap text-text-muted">
				{formatters
					.dateTime({ timeStyle: "short", dateStyle: "medium" })
					.format(new Date(props.file.modifiedAt))}
			</td>
			<td className="px-3 py-3 text-right">
				<Button
					type="button"
					variant="secondary"
					onClick={() => props.onDownload(props.file)}
					disabled={props.loading || props.downloading !== undefined}
					aria-label={t(
						kernelMessage("client.instance-admin.logs.download-file", { name: props.file.name }),
					)}
				>
					{t(
						kernelMessage(
							props.downloading === props.file.id
								? "client.instance-admin.logs.downloading"
								: "common.action.download",
						),
					)}
				</Button>
			</td>
		</tr>
	);
}
