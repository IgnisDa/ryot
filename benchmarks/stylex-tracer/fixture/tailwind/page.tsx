/* oxlint-disable perfectionist/sort-jsx-props, perfectionist/sort-objects, import/no-unassigned-import -- Keep the equivalent fixture aligned with the StyleX source. */
import {
	usePluginScreenSurface,
	usePluginTitle,
	useRyotViewport,
} from "@ryot-app/client-sdk/plugin";
import { useRyotTheme } from "@ryot-app/client-sdk/react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import "./styles.css";
import tracerMark from "./tracer-mark.svg";

export default function TailwindTracerPage() {
	const theme = useRyotTheme();
	const viewport = useRyotViewport();
	const { floatingRoot } = usePluginScreenSurface();
	const [name, setName] = useState("Ryot");
	const [progress, setProgress] = useState(35);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const detailsButtonRef = useRef<HTMLButtonElement>(null);
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const inputId = useId();
	const detailsId = useId();
	const invalid = name.trim().length === 0;
	usePluginTitle("StyleX tracer");

	useEffect(() => {
		if (detailsOpen) {
			closeButtonRef.current?.focus();
		}
	}, [detailsOpen]);

	const closeDetails = () => {
		setDetailsOpen(false);
		detailsButtonRef.current?.focus();
	};

	return (
		<div className="tracer-document" data-theme={theme.resolvedMode}>
			<header className="tracer-intro">
				<img className="tracer-mark" alt="" width={44} height={44} src={tracerMark} />
				<div>
					<div className="tracer-badge">Archive-local token</div>
					<p className="tracer-copy">
						This document uses explicit Tailwind baseline foreground, background, typography, and
						box sizing.
					</p>
				</div>
			</header>
			<section
				className="tracer-panel"
				data-layout={viewport.compact ? "compact" : "wide"}
				style={{
					paddingBlockEnd: viewport.safeAreaBottom + 24,
					paddingBlockStart: viewport.safeAreaTop + 24,
				}}
			>
				<header className="tracer-header">
					<div className="tracer-eyebrow">Shared UI SDK experiment</div>
					<h2 className="tracer-heading">StyleX tracer</h2>
					<p className="tracer-readout" role="status">
						Resolved theme: <strong>{theme.resolvedMode}</strong> · Layout:{" "}
						<strong>{viewport.compact ? "compact" : "wide"}</strong>
					</p>
				</header>

				<div className={`tracer-body ${viewport.compact ? "" : "tracer-body-wide"}`}>
					<label className="tracer-field" htmlFor={inputId}>
						<span className="tracer-label">Name</span>
						<input
							id={inputId}
							className={`tracer-input ${invalid ? "tracer-input-invalid" : ""}`}
							type="text"
							value={name}
							placeholder="Enter a name"
							aria-invalid={invalid || undefined}
							aria-describedby={invalid ? `${inputId}-error` : undefined}
							onChange={(event) => setName(event.currentTarget.value)}
						/>
						{invalid && (
							<span className="tracer-error" id={`${inputId}-error`} role="alert">
								Name is required.
							</span>
						)}
					</label>

					<div className="tracer-progress-group">
						<div className="tracer-progress-label">
							<span>Progress</span>
							<strong>{progress}%</strong>
						</div>
						<div
							className="tracer-progress-track"
							aria-label="Tracer progress"
							aria-valuemax={100}
							aria-valuemin={0}
							aria-valuenow={progress}
							role="progressbar"
						>
							<div className="tracer-progress-fill" style={{ width: `${progress}%` }} />
						</div>
					</div>
				</div>

				<div className={`tracer-actions ${viewport.compact ? "tracer-actions-compact" : ""}`}>
					<button
						className="tracer-button tracer-button-primary tracer-button-override"
						disabled={invalid || progress === 100}
						onClick={() => setProgress((current) => Math.min(100, current + 7))}
					>
						Advance progress
					</button>
					<button
						className="tracer-button tracer-button-secondary"
						onClick={() => {
							setName("Ryot");
							setProgress(35);
						}}
					>
						Reset
					</button>
					<button
						className="tracer-button tracer-button-secondary"
						ref={detailsButtonRef}
						aria-controls={detailsId}
						aria-expanded={detailsOpen}
						onClick={() => setDetailsOpen(true)}
					>
						Details
					</button>
				</div>

				{detailsOpen &&
					floatingRoot !== null &&
					createPortal(
						<div
							className="tracer-portal"
							data-theme={theme.resolvedMode}
							id={detailsId}
							aria-label="Tracer details"
							role="dialog"
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									closeDetails();
								}
							}}
						>
							<div>
								<h3 className="tracer-portal-heading">Current details</h3>
								<p className="tracer-portal-text">Name: {invalid ? "No name" : name}</p>
								<p className="tracer-portal-text">Progress: {progress}%</p>
							</div>
							<button
								className="tracer-button tracer-button-secondary"
								ref={closeButtonRef}
								onClick={closeDetails}
							>
								Close details
							</button>
						</div>,
						floatingRoot,
					)}
			</section>
		</div>
	);
}
