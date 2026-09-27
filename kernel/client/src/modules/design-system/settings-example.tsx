import {
	Badge,
	Button,
	Checkbox,
	Dialog,
	Field,
	Notice,
	Row,
	RowGroup,
	Select,
	Switch,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { EntityArtWell } from "@ryot-app/plugin-ui-sdk/sync";
import { useRef, useState, type ReactNode } from "react";

import { HERO_ART } from "#/modules/design-system/fixtures";

function Section(props: {
	readonly title: string;
	readonly detail: string;
	readonly children: ReactNode;
}) {
	return (
		<section className="grid gap-3">
			<div className="grid gap-0.5">
				<h2 className="text-heading font-semibold text-text">{props.title}</h2>
				<p className="text-[13px] text-text-muted">{props.detail}</p>
			</div>
			{props.children}
		</section>
	);
}

const restError = (value: string) => {
	const seconds = Number(value);
	return value.trim() === "" || !Number.isInteger(seconds) || seconds < 0 || seconds > 600
		? "Rest must be a whole number between 0 and 600 seconds."
		: undefined;
};

export function SettingsExample() {
	const disconnectRef = useRef<HTMLButtonElement>(null);
	const [rest, setRest] = useState("900");
	const [unit, setUnit] = useState("kg");
	const [saved, setSaved] = useState(false);
	const [paused, setPaused] = useState(false);
	const [language, setLanguage] = useState("provider");
	const [reduceMotion, setReduceMotion] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [prompts, setPrompts] = useState({ rest: false, countdown: true });
	const error = restError(rest);

	return (
		<div className="grid max-w-2xl gap-8">
			<Section title="Appearance" detail="Applies to this device only.">
				<RowGroup>
					<Row
						title="Reduce motion"
						description="Removes transitions and timer animations."
						trailing={
							<Switch label="Reduce motion" checked={reduceMotion} onChange={setReduceMotion} />
						}
					/>
					<Row
						title="Pause all integrations"
						description="Stops external processing for your account."
						trailing={
							<Switch checked={paused} onChange={setPaused} label="Pause all integrations" />
						}
					/>
				</RowGroup>
			</Section>

			<Section
				title="Language & units"
				detail="Provider availability decides which titles can be translated."
			>
				<div className="grid gap-4 rounded-lg border border-border-card bg-surface p-4">
					<div className="grid gap-4 sm:grid-cols-2">
						<Field label="Content language">
							{(control) => (
								<Select
									id={control.id}
									value={language}
									onChange={setLanguage}
									label="Content language"
									checkIcon={<AppIcon size={15} name="check" />}
									chevronIcon={<AppIcon size={15} name="chevron-down" />}
									choices={[
										{ value: "provider", label: "Provider default" },
										{ value: "en", label: "English" },
										{ value: "ja", label: "日本語" },
									]}
								/>
							)}
						</Field>
						<Field label="Weight unit">
							{(control) => (
								<Select
									value={unit}
									id={control.id}
									onChange={setUnit}
									label="Weight unit"
									checkIcon={<AppIcon size={15} name="check" />}
									chevronIcon={<AppIcon size={15} name="chevron-down" />}
									choices={[
										{ value: "kg", label: "Kilograms (kg)" },
										{ value: "lb", label: "Pounds (lb)" },
									]}
								/>
							)}
						</Field>
					</div>
					<Field
						error={error}
						label="Default rest between sets"
						hint="Used when an exercise has no rest of its own."
					>
						{(control) => (
							<TextField
								{...control}
								value={rest}
								className="w-40"
								inputMode="numeric"
								invalid={control.invalid}
								onChange={(event) => {
									setSaved(false);
									setRest(event.currentTarget.value);
								}}
							/>
						)}
					</Field>
					<Field optional label="Display name for shared reviews">
						{(control) => (
							<TextField
								{...control}
								className="w-full"
								placeholder="Shown instead of your username"
							/>
						)}
					</Field>
					<fieldset className="grid gap-2.5">
						<legend className="mb-2 text-[13px] font-medium text-text">Workout prompts</legend>
						<Checkbox
							checked={prompts.countdown}
							label="Execution countdown for duration sets"
							onChange={(event) =>
								setPrompts({ ...prompts, countdown: event.currentTarget.checked })
							}
						/>
						<Checkbox
							checked={prompts.rest}
							label="Prompt before starting rest (Pro)"
							onChange={(event) => setPrompts({ ...prompts, rest: event.currentTarget.checked })}
						/>
						<Checkbox disabled label="Play sounds on this device (unavailable in browsers)" />
					</fieldset>
				</div>
			</Section>

			<Section
				title="Connected services"
				detail="Integrations run on your server on a schedule or as events arrive."
			>
				<RowGroup>
					<Row
						title="Trakt"
						description="Last synced 4 minutes ago · 1,284 items"
						leading={
							<EntityArtWell
								monogram="T"
								state="ready"
								url={HERO_ART}
								shape="rounded"
								className="size-8 shrink-0"
							/>
						}
						trailing={
							<div className="flex items-center gap-2">
								<Badge dot size="sm" variant="success">
									Connected
								</Badge>
								<Button
									size="sm"
									ref={disconnectRef}
									variant="dangerGhost"
									onClick={() => setConfirming(true)}
								>
									Disconnect
								</Button>
							</div>
						}
					/>
					<Row
						title="Audiobookshelf (self-hosted, audiobooks.home.arpa)"
						description={
							<span className="text-danger">
								Couldn't reach the server. Check the URL and token.
							</span>
						}
						leading={
							<EntityArtWell
								monogram="A"
								state="ready"
								url={undefined}
								shape="rounded"
								className="size-8 shrink-0"
							/>
						}
						trailing={
							<div className="flex items-center gap-2">
								<Badge size="sm" variant="danger">
									Error
								</Badge>
								<Button size="sm" variant="secondary">
									Retry
								</Button>
							</div>
						}
					/>
				</RowGroup>
			</Section>

			{saved && (
				<Notice
					tone="success"
					title="Preferences saved"
					icon={<AppIcon size={16} name="circle-check" />}
				/>
			)}
			<div className="flex items-center justify-end gap-3">
				{error !== undefined && (
					<span className="text-xs text-text-muted">1 error to fix before saving</span>
				)}
				<Button variant="ghost" onClick={() => setRest("90")}>
					Reset
				</Button>
				<Button disabled={error !== undefined} onClick={() => setSaved(true)}>
					Save changes
				</Button>
			</div>

			{confirming && (
				<Dialog
					size="sm"
					closeLabel="Close"
					title="Disconnect Trakt?"
					triggerRef={disconnectRef}
					onClose={() => setConfirming(false)}
					closeIcon={<AppIcon name="x" size={16} />}
					description="Ryot stops syncing your watch history from Trakt. The 1,284 items it already imported stay in your library."
					footer={
						<>
							<Button variant="ghost" onClick={() => setConfirming(false)}>
								Cancel
							</Button>
							<Button variant="danger" onClick={() => setConfirming(false)}>
								Disconnect
							</Button>
						</>
					}
				/>
			)}
		</div>
	);
}
