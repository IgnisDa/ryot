import type { AssistantConversationStatus } from "@ryot-app/contract/modules/assistant/schemas";
import type { AssistantTranscriptTurn } from "@ryot-app/ryotql-recipes/assistant";
import clsx from "clsx";
import { useEffect, useId, useState } from "react";

export type AssistantMood = "done" | "idle" | "oops" | "waiting" | "working" | "thinking";

export const assistantMoodLabels: Record<AssistantMood, string> = {
	done: "Done",
	idle: "Ready",
	working: "Working…",
	thinking: "Thinking…",
	oops: "Something went wrong",
	waiting: "Needs your approval",
};

const INK = "#2a1606";
const CELEBRATION_MS = 2400;

const conversationMoods: Record<AssistantConversationStatus, AssistantMood> = {
	idle: "idle",
	failed: "oops",
	working: "working",
	"awaiting-input": "waiting",
	"awaiting-approval": "waiting",
};

export const conversationMood = (status: AssistantConversationStatus) => conversationMoods[status];

export const turnMood = (turn: undefined | AssistantTranscriptTurn): AssistantMood => {
	if (turn === undefined) {
		return "idle";
	}
	if (turn.status === "awaiting-approval" || turn.status === "awaiting-input") {
		return "waiting";
	}
	if (turn.status === "failed") {
		return "oops";
	}
	if (turn.status !== "queued" && turn.status !== "running") {
		return "idle";
	}
	if (turn.entries.length === 0) {
		return "working";
	}
	const last = turn.entries[turn.entries.length - 1];
	if (last.kind !== "steps" || last.steps.length === 0) {
		return "working";
	}
	return last.steps[last.steps.length - 1].kind === "reasoning" ? "thinking" : "working";
};

const line = (d: string, width = 3.2) => (
	<path
		d={d}
		fill="none"
		stroke={INK}
		strokeWidth={width}
		strokeLinecap="round"
		strokeLinejoin="round"
	/>
);

const sparkle = (x: number, y: number, r: number, fill: string) => (
	<path
		fill={fill}
		d={`M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`}
	/>
);

export function AssistantSprite(props: {
	readonly className?: string;
	readonly mood: AssistantMood;
}) {
	const gradient = `assistant-sprite-${useId().replaceAll(/[^\w-]/g, "")}`;
	const [previous, setPrevious] = useState(props.mood);
	const [celebrating, setCelebrating] = useState(false);
	if (previous !== props.mood) {
		setPrevious(props.mood);
		setCelebrating(props.mood === "idle" && (previous === "working" || previous === "thinking"));
	}
	useEffect(() => {
		if (!celebrating) {
			return undefined;
		}
		const timer = setTimeout(() => setCelebrating(false), CELEBRATION_MS);
		return () => clearTimeout(timer);
	}, [celebrating]);
	const mood = celebrating ? "done" : props.mood;
	return (
		<svg
			data-mood={mood}
			aria-hidden="true"
			viewBox="0 0 120 132"
			className={clsx("assistant-sprite shrink-0 overflow-visible", props.className)}
		>
			<defs>
				<linearGradient x1="0" y1="0" x2="0" y2="1" id={gradient}>
					<stop offset="0" stopColor="#ffd166" />
					<stop offset="0.48" stopColor="#ff922b" />
					<stop offset="1" stopColor="#f0590a" />
				</linearGradient>
			</defs>
			<ellipse ry={5} cx={60} rx={30} cy={125} className="assistant-sprite-shadow fill-text/15" />
			<g className="assistant-sprite-body">
				<path
					fill={`url(#${gradient})`}
					d="M62 8C70 28 100 46 100 76C100 99 82 114 60 114C38 114 20 99 20 76C20 50 50 36 62 8Z"
				/>
				<ellipse cx={60} cy={98} rx={26} ry={11} fill="#fff" opacity={0.16} />
				<ellipse
					cx={38}
					cy={66}
					rx={5.5}
					ry={10.5}
					fill="#fff"
					opacity={0.5}
					transform="rotate(-24 38 66)"
				/>
				{[41, 79].map((x) => (
					<ellipse
						cx={x}
						key={x}
						cy={89}
						rx={5.6}
						ry={3.2}
						fill="#ff5c8a"
						opacity={mood === "done" ? 0.7 : 0.45}
					/>
				))}
				<Eyes mood={mood} />
				<Mouth mood={mood} />
			</g>
			<Flourish mood={mood} />
		</svg>
	);
}

function Mouth(props: { readonly mood: AssistantMood }) {
	const [x, y] = [60, 91];
	if (props.mood === "thinking") {
		return <circle r={2.5} cx={x + 3} cy={y + 1} fill={INK} />;
	}
	if (props.mood === "waiting") {
		return <ellipse cx={x} rx={3.6} ry={4.4} fill={INK} cy={y + 1.5} />;
	}
	if (props.mood === "done") {
		return (
			<>
				<path fill={INK} d={`M${x - 8} ${y - 1}Q${x} ${y + 12} ${x + 8} ${y - 1}Z`} />
				<path fill="#ff8787" d={`M${x - 4} ${y + 4.6}Q${x} ${y + 8.4} ${x + 4} ${y + 4.6}Z`} />
			</>
		);
	}
	if (props.mood === "oops") {
		return line(`M${x - 7} ${y + 2}q2.3 -3 4.6 0t4.6 0t4.6 0`, 2.6);
	}
	if (props.mood === "working") {
		return line(`M${x - 4} ${y + 1}Q${x} ${y + 3} ${x + 4} ${y + 1}`, 2.8);
	}
	return line(`M${x - 5} ${y}Q${x} ${y + 5} ${x + 5} ${y}`, 2.8);
}

function Flourish(props: { readonly mood: AssistantMood }) {
	if (props.mood === "thinking") {
		return (
			<g fill="#9775fa" className="assistant-sprite-think">
				<circle r={3} cx={93} cy={34} />
				<circle cy={24} r={4.2} cx={102} />
				<circle cy={12} r={5.4} cx={112} />
			</g>
		);
	}
	if (props.mood === "working") {
		return (
			<g className="assistant-sprite-orbit">
				{sparkle(12, 50, 6.5, "#20c997")}
				{sparkle(108, 44, 5.5, "#4dabf7")}
				{sparkle(100, 104, 4.5, "#fcc419")}
			</g>
		);
	}
	if (props.mood === "waiting") {
		return (
			<g className="assistant-sprite-alert">
				<rect y={1} x={86} rx={10} width={29} height={26} fill="#fcc419" />
				<path fill="#fcc419" d="M93 25L90 33L100 26Z" />
				<rect y={6} x={98.8} rx={1.8} fill={INK} width={3.6} height={11.5} />
				<circle r={2.1} cy={21.4} cx={100.6} fill={INK} />
			</g>
		);
	}
	if (props.mood === "done") {
		return (
			<g className="assistant-sprite-twinkle">
				{sparkle(14, 32, 6.5, "#fcc419")}
				{sparkle(106, 30, 5.5, "#f783ac")}
				{sparkle(98, 8, 4, "#69db7c")}
			</g>
		);
	}
	if (props.mood === "oops") {
		return (
			<path
				fill="#74c0fc"
				className="assistant-sprite-sweat"
				d="M101 42C105 50 107 54 107 57a6 6 0 0 1-12 0C95 54 97 50 101 42Z"
			/>
		);
	}
	return null;
}

function Eyes(props: { readonly mood: AssistantMood }) {
	const [left, right, y] = [48, 72, 80];
	if (props.mood === "done") {
		return (
			<>
				{line(`M${left - 6} ${y + 2}Q${left} ${y - 6} ${left + 6} ${y + 2}`)}
				{line(`M${right - 6} ${y + 2}Q${right} ${y - 6} ${right + 6} ${y + 2}`)}
			</>
		);
	}
	if (props.mood === "oops") {
		return (
			<>
				<circle r={4} cx={left} cy={y + 1} fill={INK} />
				<circle r={4} cx={right} cy={y + 1} fill={INK} />
				{line(`M${left - 6} ${y - 7}L${left + 5} ${y - 10}`, 2.6)}
				{line(`M${right - 5} ${y - 10}L${right + 6} ${y - 7}`, 2.6)}
			</>
		);
	}
	const radius = props.mood === "waiting" ? 6.2 : 5.4;
	const [dx, dy] = props.mood === "thinking" ? [2.2, -2.6] : [0, 0];
	return (
		<>
			<g className="assistant-sprite-eyes">
				{[left, right].map((x) => (
					<g key={x}>
						<circle r={radius} fill={INK} cx={x + dx} cy={y + dy} />
						<circle fill="#fff" cx={x + dx - 1.9} cy={y + dy - 2.1} r={radius * 0.34} />
					</g>
				))}
			</g>
			{props.mood === "working" ? (
				<>
					{line(`M${left - 6} ${y - 10}L${left + 5} ${y - 8}`, 2.6)}
					{line(`M${right - 5} ${y - 8}L${right + 6} ${y - 10}`, 2.6)}
				</>
			) : null}
			{props.mood === "waiting" ? (
				<>
					{line(`M${left - 6} ${y - 11}Q${left} ${y - 16} ${left + 6} ${y - 11}`, 2.6)}
					{line(`M${right - 6} ${y - 11}Q${right} ${y - 16} ${right + 6} ${y - 11}`, 2.6)}
				</>
			) : null}
		</>
	);
}
