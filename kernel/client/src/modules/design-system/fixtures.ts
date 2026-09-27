const poster = (from: string, to: string, accent: string) =>
	`data:image/svg+xml,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="200" height="300" fill="url(#g)"/><circle cx="140" cy="90" r="36" fill="${accent}" opacity="0.85"/></svg>`,
	)}`;

export type MediaFixture = {
	readonly id: string;
	readonly year: string;
	readonly title: string;
	readonly kind: string;
	readonly progress: string;
	readonly lastActivity: string;
	readonly art: string | undefined;
	readonly status: "completed" | "hold" | "in-progress" | "untracked";
};

export const MEDIA_ITEMS: ReadonlyArray<MediaFixture> = [
	{
		id: "ram",
		year: "2013",
		kind: "Album",
		status: "completed",
		progress: "13 / 13",
		lastActivity: "Today, 08:14",
		title: "Random Access Memories",
		art: poster("#2a1830", "#e0704a", "#f1c27d"),
	},
	{
		year: "2001",
		kind: "Album",
		id: "discovery",
		title: "Discovery",
		progress: "9 / 14",
		status: "in-progress",
		lastActivity: "Oct 12",
		art: poster("#6a3093", "#fda085", "#f6d365"),
	},
	{
		id: "alive",
		year: "2007",
		kind: "Album",
		progress: "—",
		art: undefined,
		lastActivity: "—",
		status: "untracked",
		title: "Alive 2007 (Live at the Palais Omnisports de Paris-Bercy)",
	},
	{
		year: "1997",
		kind: "Album",
		progress: "—",
		id: "homework",
		title: "Homework",
		lastActivity: "—",
		status: "untracked",
		art: poster("#e8e2d6", "#b23a2e", "#1b1a17"),
	},
	{
		id: "tron",
		year: "2010",
		kind: "Soundtrack",
		status: "completed",
		progress: "22 / 22",
		lastActivity: "Sep 30",
		art: poster("#1f3b4d", "#d8a35a", "#3e6f78"),
		title: "Tron: Legacy (Original Motion Picture Soundtrack)",
	},
	{
		id: "human",
		year: "2005",
		kind: "Album",
		status: "hold",
		progress: "4 / 11",
		lastActivity: "Aug 2",
		title: "Human After All",
		art: poster("#0e0e10", "#4a4a52", "#c7c2b8"),
	},
];

export const HERO_ART = poster("#2a1830", "#e0704a", "#f1c27d");

export type SetFixture = {
	readonly id: string;
	readonly a: string;
	readonly b: string;
	readonly rpe?: string;
	readonly note?: string;
	readonly done: boolean;
	readonly previous: string;
	readonly error?: string;
	readonly kind: "drop" | "failure" | "normal" | "warmup";
};

export type ExerciseFixture = {
	readonly id: string;
	readonly name: string;
	readonly meta: string;
	readonly note?: string;
	readonly superset?: string;
	readonly restLabel: string;
	readonly art: string | undefined;
	readonly sets: ReadonlyArray<SetFixture>;
	readonly columns: readonly [string, string];
};

export const EXERCISES: ReadonlyArray<ExerciseFixture> = [
	{
		id: "bench",
		restLabel: "Rest 2:00",
		columns: ["kg", "Reps"],
		meta: "Barbell · Chest",
		name: "Barbell Bench Press – Medium Grip",
		art: poster("#1f3b4d", "#d8a35a", "#3e6f78"),
		sets: [
			{ a: "40", b: "10", id: "w1", done: true, kind: "warmup", previous: "40 × 10" },
			{ b: "8", rpe: "8", id: "s1", a: "72.5", done: true, kind: "normal", previous: "70 × 8" },
			{
				b: "7",
				rpe: "9",
				id: "s2",
				a: "72.5",
				done: true,
				kind: "normal",
				previous: "70 × 8",
				note: "Left shoulder felt tight on the last rep. Slow the eccentric.",
			},
			{ b: "", id: "s3", a: "72.5", done: false, kind: "normal", previous: "70 × 7" },
			{ a: "", b: "", id: "d1", done: false, kind: "drop", previous: "—" },
		],
	},
	{
		superset: "A",
		id: "incline",
		art: undefined,
		restLabel: "Rest 1:30",
		columns: ["kg", "Reps"],
		meta: "Dumbbell · Chest, Shoulders",
		note: "Bench at 30°. Pause one second at the bottom, don't bounce.",
		name: "Incline Dumbbell Press with Neutral Grip and Pause at the Bottom of Each Repetition",
		sets: [
			{ a: "", b: "", id: "i1", done: false, kind: "normal", previous: "24 × 10" },
			{
				b: "",
				a: "0",
				id: "i2",
				done: false,
				kind: "normal",
				previous: "24 × 10",
				error: "Weight must be more than 0 for a dumbbell exercise.",
			},
		],
	},
	{
		superset: "A",
		id: "pushdown",
		restLabel: "Rest 1:30",
		columns: ["kg", "Reps"],
		meta: "Cable · Triceps",
		name: "Cable Triceps Pushdown",
		art: poster("#d9e3d3", "#2f5d50", "#8fb39a"),
		sets: [{ a: "", b: "", id: "p1", done: false, previous: "—", kind: "normal" }],
	},
	{
		id: "run",
		restLabel: "No rest",
		name: "Treadmill Run",
		columns: ["km", "Time"],
		meta: "Cardio · distance and duration",
		art: poster("#0e0e10", "#4a4a52", "#fd7e14"),
		sets: [{ a: "", b: "", id: "r1", done: false, kind: "normal", previous: "3.2 · 18:40" }],
	},
];
