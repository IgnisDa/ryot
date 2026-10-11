import {
	Badge,
	Button,
	Card,
	CellInput,
	Checkbox,
	Field,
	IconButton,
	Notice,
	Radio,
	SegmentedControl,
	Skeleton,
	Switch,
	TextArea,
	TextField,
	Tooltip,
} from "@ryot-app/plugin-ui-sdk";
import { RankedBarList, Sparkline } from "@ryot-app/plugin-ui-sdk/charts";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useState, type ReactNode } from "react";

const ESTIMATED_MAX = [82, 84, 85.5, 86, 88, 89, 91.5, 94].map((value, index) => ({
	value,
	at: new Date(Date.UTC(2026, 7, 2 + index * 10)).toISOString(),
}));

function Group(props: {
	readonly title: string;
	readonly usage: string;
	readonly children: ReactNode;
}) {
	return (
		<section className="grid gap-3">
			<div className="grid gap-0.5">
				<h2 className="text-[11px] font-semibold tracking-[0.07em] text-text-subtle uppercase">
					{props.title}
				</h2>
				<p className="max-w-[72ch] text-[13px] text-text-muted">{props.usage}</p>
			</div>
			<Card className="grid gap-4">{props.children}</Card>
		</section>
	);
}

export function ComponentsExample() {
	const [on, setOn] = useState(true);
	const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");

	return (
		<div className="grid gap-8">
			<Group
				title="Buttons"
				usage="Primary marks the single next step in a region. Secondary (neutral fill) is for frequent actions; outline sits on artwork or tinted rows; ghost is for toolbars and tertiary actions. Danger is reserved for the final confirmation, and danger-ghost for destructive entries in lists."
			>
				<div className="flex flex-wrap items-center gap-2">
					<Button>Finish workout</Button>
					<Button variant="secondary">Add set</Button>
					<Button variant="outline">Reorder</Button>
					<Button variant="ghost">Skip rest</Button>
					<Button variant="dangerGhost">Discard</Button>
					<Button variant="danger">Delete 3 sets</Button>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button size="sm">Save</Button>
					<Button size="lg">Log activity</Button>
					<Button loading>Saving</Button>
					<Button disabled variant="secondary">
						Disabled
					</Button>
					<Tooltip shortcut="P" content="Pause workout">
						{(describedBy) => (
							<IconButton tone="filled" label="Pause workout" aria-describedby={describedBy}>
								<AppIcon size={16} name="pause" />
							</IconButton>
						)}
					</Tooltip>
					<IconButton label="More actions">
						<AppIcon size={16} name="more-horizontal" />
					</IconButton>
					<IconButton tone="danger" label="Delete">
						<AppIcon size={16} name="trash-2" />
					</IconButton>
				</div>
			</Group>

			<Group
				title="Inputs"
				usage="Fields are 36px on desktop and 44px with 16px text on touch devices. Labels sit above the field; hints and errors sit below and are announced through aria-describedby. Cell inputs are for repeated numeric entry in set tables."
			>
				<div className="grid gap-4 sm:grid-cols-2">
					<Field label="Display name" hint="Visible on shared reviews.">
						{(control) => <TextField {...control} className="w-full" defaultValue="Diptesh" />}
					</Field>
					<Field label="Webhook URL" error="Use an https:// address.">
						{(control) => (
							<TextField
								{...control}
								invalid
								className="w-full"
								defaultValue="http://hooks.local/ryot"
							/>
						)}
					</Field>
					<Field label="Server">
						{(control) => (
							<TextField {...control} disabled className="w-full" defaultValue="ryot.diptesh.me" />
						)}
					</Field>
					<Field optional label="Workout reflection">
						{(control) => (
							<TextArea {...control} className="w-full" placeholder="How did it feel?" />
						)}
					</Field>
				</div>
				<div className="grid w-64 grid-cols-3 gap-2">
					<CellInput aria-label="Weight" defaultValue="72.5" />
					<CellInput placeholder="8" aria-label="Reps" />
					<CellInput invalid defaultValue="0" aria-label="Invalid weight" />
				</div>
			</Group>

			<Group
				title="Choice"
				usage="Switches apply immediately. Checkboxes and radios belong to forms that are saved. Segmented controls switch between 2–4 modes or views; tabs switch between content areas of one object."
			>
				<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
					<Checkbox defaultChecked label="Mute sounds" />
					<Checkbox label="Prompt before rest" />
					<Radio label="kg" name="unit" defaultChecked />
					<Radio label="lb" name="unit" />
					<Switch checked={on} onChange={setOn} label="Monitoring" />
					<Switch disabled checked={false} onChange={setOn} label="Unavailable" />
					<SegmentedControl
						value={density}
						label="Density"
						onChange={setDensity}
						optionClassName="px-3"
						options={[
							{ value: "comfortable", label: "Comfortable", content: "Comfortable" },
							{ value: "compact", label: "Compact", content: "Compact" },
						]}
					/>
				</div>
			</Group>

			<Group
				title="Badges & feedback"
				usage="Badges encode status in tone and a dot, never in color alone. Notices are inline and persistent; danger notices are announced as alerts. Skeletons stand in for content with a known shape."
			>
				<div className="flex flex-wrap gap-1.5">
					<Badge dot variant="success">
						Completed
					</Badge>
					<Badge dot variant="accent">
						In progress
					</Badge>
					<Badge variant="neutral">Not tracked</Badge>
					<Badge variant="warning">Warm-up</Badge>
					<Badge variant="info">Pro</Badge>
					<Badge variant="danger">Failed</Badge>
					<Badge variant="outline">System</Badge>
					<Badge variant="key">⌘K</Badge>
				</div>
				<Notice tone="info" icon={<AppIcon size={16} name="info" />}>
					Measurements are saved separately from this workout.
				</Notice>
				<Notice
					tone="danger"
					title="Import failed"
					icon={<AppIcon size={16} name="circle-alert" />}
					action={
						<Button size="sm" variant="secondary">
							Retry
						</Button>
					}
				>
					TMDB rejected the API key. Update it in Integrations and retry.
				</Notice>
				<div className="grid gap-2">
					<Skeleton className="h-3 w-2/3" />
					<Skeleton className="h-3 w-1/3" />
				</div>
			</Group>

			<Group
				title="Charts"
				usage="The accent carries the primary series and info-blue the comparison. Labels use text tokens; the latest point is emphasized."
			>
				<div className="flex flex-wrap items-center gap-8">
					<div className="grid gap-1">
						<span className="text-xs text-text-muted">Estimated 1RM · bench press</span>
						<span className="text-metric font-semibold text-text tabular-nums">94 kg</span>
						<Sparkline
							tone="accent"
							points={ESTIMATED_MAX}
							ariaLabel="Estimated 1RM, rising from 82 to 94 kg"
						/>
					</div>
					<div className="min-w-64 flex-1">
						<RankedBarList
							formatValue={(row) => `${row.value} plays`}
							rows={[
								{ value: 214, key: "daft", label: "Daft Punk" },
								{ value: 131, key: "justice", label: "Justice" },
								{ value: 72, key: "air", label: "Air" },
							]}
						/>
					</div>
				</div>
			</Group>
		</div>
	);
}
