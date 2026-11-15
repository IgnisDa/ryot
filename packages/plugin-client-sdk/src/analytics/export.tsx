import {
	Button,
	createReport,
	renderReportPng,
	ReportProvider,
	type ReportSnapshot,
	StatusMessage,
	useReportReady,
} from "@ryot-app/plugin-ui-sdk";
import { Effect, Schema } from "effect";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { useRyot, useRyotSchedule } from "../queries/provider";

class AnalyticsImageExportError extends Schema.TaggedError<
	AnalyticsImageExportError,
	{ readonly brand: unique symbol }
>()("AnalyticsImageExportError", { message: Schema.String }) {}

export function AnalyticsReport(props: {
	readonly title: string;
	readonly subtitle: string;
	readonly children: ReactNode;
}) {
	const report = useMemo(() => createReport(), []);
	return (
		<>
			<ReportExport report={report} title={props.title} subtitle={props.subtitle} />
			<ReportProvider report={report}>{props.children}</ReportProvider>
		</>
	);
}

function ReportExport(props: {
	readonly title: string;
	readonly subtitle: string;
	readonly report: ReturnType<typeof createReport>;
}) {
	const client = useRyot();
	const schedule = useRyotSchedule();
	const ready = useReportReady(props.report);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const captured = useRef<undefined | ReportSnapshot>(undefined);
	const image = useRef<Blob | undefined>(undefined);
	const capturedRevision = useRef<number | undefined>(undefined);
	const saving = useRef(false);
	const cancel = useRef<undefined | (() => void)>(undefined);
	useEffect(() => () => cancel.current?.(), []);
	const save = () => {
		if (saving.current) {
			return;
		}
		saving.current = true;
		setPending(true);
		setError(undefined);
		cancel.current = schedule.run(
			Effect.gen(function* () {
				const revision = props.report.revision();
				if (capturedRevision.current !== revision) {
					captured.current = undefined;
					image.current = undefined;
				}
				capturedRevision.current = revision;
				const snapshot =
					captured.current ??
					(yield* Effect.try({
						catch: exportError,
						try: () => props.report.snapshot(props.title, props.subtitle),
					}));
				captured.current = snapshot;
				const source = image.current ?? (yield* renderReportPng(snapshot));
				image.current = source;
				const result = yield* client.device({
					source,
					action: "export-file",
					fileName: `ryot-${props.title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}.png`,
				});
				if (result.status !== "done") {
					return yield* exportError(new Error("The image could not be saved"));
				}
				return yield* Effect.void;
			}).pipe(
				Effect.match({
					onSuccess: () => {
						captured.current = undefined;
						image.current = undefined;
						saving.current = false;
						setPending(false);
					},
					onFailure: (cause) => {
						saving.current = false;
						setPending(false);
						setError(
							cause instanceof Error ? cause.message : "The image could not be saved. Try again.",
						);
					},
				}),
			),
			() => undefined,
		);
	};
	const label = pending ? "Saving image…" : "Save image";
	return (
		<div className="flex flex-wrap items-center justify-end gap-3">
			{error === undefined ? null : <StatusMessage tone="error">{error}</StatusMessage>}
			<Button onClick={save} disabled={!ready || pending}>
				{error && !pending ? "Retry image export" : label}
			</Button>
		</div>
	);
}
const exportError = (cause: unknown) =>
	new AnalyticsImageExportError({
		message: cause instanceof Error ? cause.message : "The image could not be saved. Try again.",
	});
