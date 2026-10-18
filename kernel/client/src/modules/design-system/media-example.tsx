import {
	Badge,
	Button,
	EmptyState,
	IconButton,
	RowGroup,
	SegmentedControl,
	Switch,
	Tabs,
	tabId,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { EntityArtWell } from "@ryot-app/plugin-ui-sdk/sync";
import { DataTable, type DataTableColumn } from "@ryot-app/plugin-ui-sdk/table";
import { useState, type ReactNode } from "react";

import { HERO_ART, MEDIA_ITEMS, type MediaFixture } from "#/modules/design-system/fixtures";

const STATUS = {
	hold: { label: "On hold", variant: "warning" },
	completed: { label: "Completed", variant: "success" },
	untracked: { variant: "neutral", label: "Not tracked" },
	"in-progress": { variant: "accent", label: "Listening" },
} as const;

function StatusBadge(props: {
	readonly status: MediaFixture["status"];
	readonly size?: "md" | "sm";
}) {
	const status = STATUS[props.status];
	return (
		<Badge size={props.size} variant={status.variant} dot={props.status !== "untracked"}>
			{status.label}
		</Badge>
	);
}

const MEDIA_COLUMNS: ReadonlyArray<DataTableColumn<MediaFixture>> = [
	{
		id: "title",
		header: "Title",
		cellClassName: "px-4 py-2",
		headerClassName: "px-4 py-2 font-medium",
		cell: (item) => (
			<span className="flex min-w-56 items-center gap-3">
				<EntityArtWell
					state="ready"
					url={item.art}
					shape="rounded"
					className="size-8 shrink-0"
					monogram={item.title.slice(0, 1)}
				/>
				<span className="text-text">{item.title}</span>
			</span>
		),
	},
	{
		id: "kind",
		header: "Type",
		cell: (item) => item.kind,
		headerClassName: "px-4 py-2 font-medium",
		cellClassName: "px-4 py-2 text-text-muted",
	},
	{
		id: "status",
		header: "Status",
		cellClassName: "px-4 py-2",
		headerClassName: "px-4 py-2 font-medium",
		cell: (item) => <StatusBadge size="sm" status={item.status} />,
	},
	{
		id: "progress",
		header: "Progress",
		cell: (item) => item.progress,
		cellClassName: "px-4 py-2 text-right tabular-nums",
		headerClassName: "px-4 py-2 text-right font-medium",
	},
	{
		id: "last",
		header: "Last activity",
		cell: (item) => item.lastActivity,
		headerClassName: "px-4 py-2 text-right font-medium whitespace-nowrap",
		cellClassName: "px-4 py-2 text-right whitespace-nowrap text-text-muted",
	},
];

function KeyValue(props: {
	readonly label: string;
	readonly hint?: string;
	readonly children: ReactNode;
}) {
	return (
		<div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2.5">
			<div className="min-w-0">
				<div className="text-sm font-medium text-text">{props.label}</div>
				{props.hint !== undefined && <div className="text-xs text-text-muted">{props.hint}</div>}
			</div>
			{props.children}
		</div>
	);
}

function MediaCard(props: { readonly item: MediaFixture }) {
	return (
		<a
			href="#media"
			onClick={(event) => event.preventDefault()}
			className="group grid min-w-0 content-start gap-2 rounded-md"
		>
			<EntityArtWell
				state="ready"
				shape="rounded"
				url={props.item.art}
				monogram={props.item.title.slice(0, 1)}
				className="aspect-[2/3] w-full shadow-sm transition-transform duration-150 group-hover:-translate-y-0.5 motion-reduce:transition-none"
			/>
			<span className="line-clamp-2 text-[13px] leading-[18px] font-medium text-text">
				{props.item.title}
			</span>
			<span className="flex flex-wrap items-center gap-1.5">
				<span className="text-xs text-text-muted tabular-nums">{props.item.year}</span>
				<StatusBadge size="sm" status={props.item.status} />
			</span>
		</a>
	);
}

export function MediaExample() {
	const [tab, setTab] = useState<"credits" | "overview" | "reviews">("overview");
	const [layout, setLayout] = useState<"grid" | "list">("grid");
	const [monitoring, setMonitoring] = useState(true);

	return (
		<div className="grid gap-7">
			<div className="grid gap-7 lg:grid-cols-[11rem_minmax(0,1fr)_18rem]">
				<EntityArtWell
					monogram="G"
					state="ready"
					url={HERO_ART}
					shape="rounded"
					className="aspect-square w-40 shadow-card lg:w-full"
				/>
				<div className="grid min-w-0 content-start gap-3.5">
					<h2 className="font-display text-display font-semibold tracking-tight text-balance text-text">
						Get Lucky (feat. Pharrell Williams and Nile Rodgers)
					</h2>
					<p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-text-muted">
						<span>Daft Punk</span>
						<span aria-hidden="true">·</span>
						<span>2013</span>
						<span aria-hidden="true">·</span>
						<span className="tabular-nums">6:10</span>
						<span aria-hidden="true">·</span>
						<span>YouTube Music</span>
					</p>
					<div className="flex flex-wrap gap-1.5">
						<StatusBadge status="in-progress" />
						<Badge variant="neutral">Funk</Badge>
						<Badge variant="neutral">Disco</Badge>
						<Badge variant="neutral">Electronic</Badge>
					</div>
					<p className="max-w-[62ch] text-[15px] leading-6 text-text-muted">
						The lead single from Random Access Memories, recorded with Nile Rodgers on guitar and
						Pharrell Williams on vocals. It topped the charts in more than 30 countries.
					</p>
					<div className="flex flex-wrap items-center gap-2">
						<Button>
							<AppIcon size={15} name="plus" />
							Log activity
						</Button>
						<Button variant="secondary">
							<AppIcon size={15} name="star" />
							Write review
						</Button>
						<IconButton label="More actions">
							<AppIcon size={16} name="more-horizontal" />
						</IconButton>
					</div>
				</div>
				<RowGroup className="self-start">
					<KeyValue label="Your status">
						<StatusBadge size="sm" status="in-progress" />
					</KeyValue>
					<KeyValue label="Monitoring" hint="Keep provider details up to date">
						<Switch label="Monitoring" checked={monitoring} onChange={setMonitoring} />
					</KeyValue>
					<KeyValue label="Plays">
						<span className="text-sm text-text tabular-nums">14</span>
					</KeyValue>
					<KeyValue label="Ownership">
						<span className="text-sm text-text-muted">Not recorded</span>
					</KeyValue>
					<KeyValue label="Collections" hint="Not in any collection">
						<Button size="sm" variant="ghost">
							Manage
						</Button>
					</KeyValue>
				</RowGroup>
			</div>

			<Tabs
				value={tab}
				onChange={setTab}
				label="Track sections"
				panelId="media-example-panel"
				options={[
					{ value: "overview", label: "Overview" },
					{
						value: "credits",
						label: "Credits",
						trailing: (
							<Badge size="sm" variant="neutral">
								12
							</Badge>
						),
					},
					{ value: "reviews", label: "Reviews" },
				]}
			/>

			<div
				role="tabpanel"
				className="grid gap-8"
				id="media-example-panel"
				aria-labelledby={tabId("media-example-panel", tab)}
			>
				<section className="grid gap-3">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<h3 className="text-heading font-semibold text-text">More from Daft Punk</h3>
						<SegmentedControl
							value={layout}
							label="Layout"
							onChange={setLayout}
							options={[
								{ value: "grid", label: "Grid", content: <AppIcon size={15} name="grid" /> },
								{ value: "list", label: "List", content: <AppIcon size={15} name="list" /> },
							]}
						/>
					</div>
					{layout === "grid" ? (
						<div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-4 gap-y-5">
							{MEDIA_ITEMS.map((item) => (
								<MediaCard item={item} key={item.id} />
							))}
						</div>
					) : (
						<RowGroup>
							<div className="overflow-x-auto">
								<DataTable
									data={MEDIA_ITEMS}
									columns={MEDIA_COLUMNS}
									getRowId={(item) => item.id}
									className="w-full border-collapse text-[13px]"
									rowClassName="border-t border-border hover:bg-hover"
									headerClassName="text-left text-xs font-medium text-text-subtle"
								/>
							</div>
						</RowGroup>
					)}
				</section>

				<section className="grid gap-3">
					<h3 className="text-heading font-semibold text-text">Reviews</h3>
					<RowGroup>
						<EmptyState
							title="No reviews yet"
							icon={<AppIcon size={18} name="star" />}
							description="Rate this track and add notes for yourself. Reviews stay private unless you share them."
							action={
								<Button size="sm" variant="secondary">
									Write review
								</Button>
							}
						/>
					</RowGroup>
				</section>
			</div>
		</div>
	);
}
