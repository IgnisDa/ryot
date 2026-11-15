import { Effect, Schema } from "effect";
import {
	createContext,
	isValidElement,
	type ReactNode,
	type RefObject,
	useContext,
	useId,
	useLayoutEffect,
	useRef,
	useSyncExternalStore,
} from "react";

export type ReportBlock = TextBlock | ChartBlock | TableBlock | LegendBlock;
export type ReportSnapshot = {
	readonly title: string;
	readonly subtitle: string;
	readonly blocks: readonly ReportBlock[];
	readonly palette: { readonly text: string; readonly background: string };
};
type TextBlock = {
	readonly kind: "text";
	readonly lines: readonly string[];
	readonly title?: string | undefined;
};
type Entry = {
	readonly blocked: boolean;
	readonly read: () => ReportBlock;
	readonly element: RefObject<null | HTMLElement>;
};
type ChartBlock = {
	readonly svg: string;
	readonly kind: "chart";
	readonly title: string;
	readonly width: number;
	readonly height: number;
};
type TableBlock = {
	readonly kind: "table";
	readonly title?: string | undefined;
	readonly headers: readonly string[];
	readonly rows: readonly (readonly string[])[];
};
type LegendBlock = {
	readonly kind: "legend";
	readonly title?: string | undefined;
	readonly items: readonly {
		readonly label: string;
		readonly color: string;
		readonly mark: "bar" | "line";
		readonly dashed?: boolean | undefined;
	}[];
};

export const reportText = (value: ReactNode): string => {
	if (typeof value === "string" || typeof value === "number") {
		return String(value);
	}
	if (Array.isArray(value)) {
		return value.map(reportText).join(" ");
	}
	if (isValidElement<{ children?: ReactNode; "aria-hidden"?: "true" | boolean | "false" }>(value)) {
		if (value.props["aria-hidden"] === true || value.props["aria-hidden"] === "true") {
			return "";
		}
		if (value.props.children === undefined) {
			if (typeof value.type === "string" && ["br", "svg", "path", "span"].includes(value.type)) {
				return "";
			}
			throw new Error("This report contains a value without a text representation");
		}
		const text = reportText(value.props.children);
		return typeof value.type === "string" && ["p", "tr", "thead", "caption"].includes(value.type)
			? `${text}\n`
			: text;
	}
	return "";
};

export const createReport = () => {
	const entries = new Map<string, Entry>();
	const listeners = new Set<() => void>();
	let revision = 0;
	const publish = () => {
		revision++;
		for (const listener of listeners) {
			listener();
		}
	};
	return {
		revision: () => revision,
		ready: () => entries.size > 0 && ![...entries.values()].some((entry) => entry.blocked),
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		register: (key: string, entry: Entry) => {
			entries.set(key, entry);
			publish();
			return () => {
				entries.delete(key);
				publish();
			};
		},
		snapshot: (title: string, subtitle: string): ReportSnapshot => {
			if (entries.size === 0 || [...entries.values()].some((entry) => entry.blocked)) {
				throw new Error("Wait for the report to finish loading");
			}
			const ordered = [...entries.values()].sort((a, b) => {
				const left = a.element.current,
					right = b.element.current;
				if (!left || !right) {
					return 0;
				}
				return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
			});
			const style = getComputedStyle(document.body);
			return {
				title,
				subtitle,
				blocks: ordered.map((entry) => entry.read()),
				palette: { text: style.color, background: style.backgroundColor },
			};
		},
	};
};
export type Report = ReturnType<typeof createReport>;
const ReportContext = createContext<null | Report>(null);
export function ReportProvider(props: {
	readonly children: ReactNode;
	readonly report: null | Report;
}) {
	return <ReportContext.Provider value={props.report}>{props.children}</ReportContext.Provider>;
}
const useReport = () => useContext(ReportContext);
export const useReportReady = (report: Report) => {
	useSyncExternalStore(report.subscribe, report.revision, report.revision);
	return report.ready();
};
export const useReportBlock = (read: () => ReportBlock, blocked = false) => {
	const report = useReport();
	const key = useId();
	const element = useRef<HTMLDivElement>(null);
	useLayoutEffect(
		() => report?.register(key, { read, element, blocked }),
		[report, key, read, blocked],
	);
	return element;
};
class ReportExportError extends Schema.TaggedError<
	ReportExportError,
	{ readonly brand: unique symbol }
>()("ReportExportError", { message: Schema.String }) {}

export function ReportText(props: {
	readonly blocked?: boolean;
	readonly children: ReactNode;
	readonly title?: string | undefined;
}) {
	const read = (): ReportBlock => ({
		kind: "text",
		title: props.title,
		lines: reportText(props.children)
			.split("\n")
			.filter((line) => line.trim() !== ""),
	});
	const ref = useReportBlock(read, props.blocked);
	return (
		<div ref={ref} className="contents">
			{props.children}
		</div>
	);
}
const fontFamily = "Arial, sans-serif";
const escapeXml = (text: string) =>
	text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const wrap = (text: string, width: number, measure: (value: string) => number) => {
	const lines: string[] = [];
	let line = "";
	for (const word of text.trim().split(/\s+/)) {
		const candidate = line ? `${line} ${word}` : word;
		if (measure(candidate) <= width) {
			line = candidate;
			continue;
		}
		if (line) {
			lines.push(line);
		}
		line = "";
		for (const { segment } of graphemes.segment(word)) {
			if (measure(line + segment) > width) {
				if (line === "") {
					throw new Error("A report character exceeds the available image width");
				}
				lines.push(line);
				line = segment;
			} else {
				line += segment;
			}
		}
	}
	if (line) {
		lines.push(line);
	}
	return lines;
};
export const reportSvg = (
	snapshot: ReportSnapshot,
	measure: (value: string, size: number) => number,
) => {
	let y = 44;
	const parts: string[] = [];
	const text = (value: string, size = 16, x = 40) => {
		for (const line of wrap(value, 1160 - x, (candidate) => measure(candidate, size))) {
			parts.push(
				`<text x="${x}" y="${y}" font-size="${size}" fill="${escapeXml(snapshot.palette.text)}" font-family="${fontFamily}">${escapeXml(line)}</text>`,
			);
			y += size + 10;
		}
	};
	text(snapshot.title, 28);
	text(snapshot.subtitle);
	y += 16;
	for (const block of snapshot.blocks) {
		if (block.title) {
			text(block.title, 20);
		}
		if (block.kind === "text") {
			for (const line of block.lines) {
				text(line);
			}
		} else if (block.kind === "table") {
			text(block.headers.join(" | "));
			for (const row of block.rows) {
				text(row.join(" | "));
			}
		} else if (block.kind === "legend") {
			for (const item of block.items) {
				const start = y;
				parts.push(
					item.mark === "bar"
						? `<rect x="40" y="${y - 10}" width="14" height="10" rx="2" fill="${escapeXml(item.color)}"/>`
						: `<line x1="40" x2="56" y1="${y - 5}" y2="${y - 5}" stroke="${escapeXml(item.color)}" stroke-width="2"${item.dashed ? ' stroke-dasharray="4 3"' : ""}/>`,
				);
				text(item.label, 16, 66);
				y = Math.max(y, start + 26);
			}
		} else {
			const parsed = new DOMParser().parseFromString(block.svg, "image/svg+xml");
			if (parsed.querySelector("parsererror")) {
				throw new Error("Chart could not be serialized");
			}
			const svg = parsed.documentElement;
			svg.setAttribute("x", "40");
			svg.setAttribute("y", String(y));
			svg.setAttribute("width", String(block.width));
			svg.setAttribute("height", String(block.height));
			for (const node of svg.querySelectorAll("text")) {
				node.setAttribute("font-family", fontFamily);
				node.setAttribute("style", `${node.getAttribute("style") ?? ""};font-family:${fontFamily}`);
			}
			parts.push(new XMLSerializer().serializeToString(svg));
			y += block.height;
		}
		y += 20;
	}
	if (y > 6000) {
		throw new Error(
			"This report is too large for one image. Select fewer rows or a smaller report.",
		);
	}
	return {
		width: 1200,
		height: y + 20,
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${y + 20}"><rect width="100%" height="100%" fill="${escapeXml(snapshot.palette.background)}"/>${parts.join("")}</svg>`,
	};
};
const imageError = (cause: unknown) =>
	new ReportExportError({
		message: cause instanceof Error ? cause.message : "Could not render the report",
	});
export const renderReportPng = Effect.fn("renderReportPng")(function* (snapshot: ReportSnapshot) {
	const surface = yield* Effect.try({
		catch: imageError,
		try: () => {
			const canvas = document.createElement("canvas");
			const context = canvas.getContext("2d");
			if (!context) {
				throw new Error("Image rendering is unavailable");
			}
			return { canvas, context };
		},
	});
	const report = yield* Effect.try({
		catch: imageError,
		try: () =>
			reportSvg(snapshot, (value, size) => {
				surface.context.font = `${size}px ${fontFamily}`;
				return surface.context.measureText(value).width;
			}),
	});
	const url = yield* Effect.acquireRelease(
		Effect.try({
			catch: imageError,
			try: () => URL.createObjectURL(new Blob([report.svg], { type: "image/svg+xml" })),
		}),
		(objectUrl) => Effect.sync(() => URL.revokeObjectURL(objectUrl)),
	);
	const image = new Image();
	image.src = url;
	yield* Effect.tryPromise({ catch: imageError, try: () => image.decode() });
	yield* Effect.try({
		catch: imageError,
		try: () => {
			surface.canvas.width = report.width;
			surface.canvas.height = report.height;
			surface.context.drawImage(image, 0, 0);
		},
	});
	return yield* Effect.callback<Blob, ReportExportError>((resume) => {
		try {
			surface.canvas.toBlob(
				(blob) =>
					resume(
						blob === null
							? Effect.fail(imageError(new Error("PNG encoding failed")))
							: Effect.succeed(blob),
					),
				"image/png",
			);
		} catch (cause) {
			resume(Effect.fail(imageError(cause)));
		}
	});
}, Effect.scoped);
