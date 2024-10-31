import type { LoaderFunctionArgs, MetaArgs } from "@remix-run/node";
import {
	LucideBellDot,
	LucideCalendarRange,
	LucideCandy,
	LucideChartColumnBig,
	LucideChartLine,
	LucideDatabaseZap,
	LucideDumbbell,
	LucideImageUp,
	LucideImport,
	LucideLayoutTemplate,
	LucideLibraryBig,
	LucideMegaphone,
	LucideMessageSquareText,
	LucideNotebookPen,
	LucideNotebookTabs,
	LucidePackageOpen,
	LucideProjector,
	LucideRefreshCcwDot,
	LucideRuler,
	LucideScale3D,
	LucideSquareStack,
	LucideTimer,
	LucideVibrate,
} from "lucide-react";
import { logoUrl } from "~/lib/utils";

export const loader = (_args: LoaderFunctionArgs) => {
	return {};
};

export const meta = (_args: MetaArgs<typeof loader>) => {
	return [{ title: "Features | Ryot" }];
};

export default function Page() {
	return (
		<div>
			<div className="bg-muted py-32">
				<img
					alt="Ryot"
					src={logoUrl}
					className="size-28 sm:size-40 mx-auto mb-10"
				/>
				<div className="space-y-4">
					<h1 className="text-center text-2xl sm:text-3xl">
						Think of Ryot as your second brain with superpowers ✨
					</h1>
					<h2 className="text-center sm:text-xl text-gray-500">
						What all can Ryot do for you?
					</h2>
				</div>
			</div>
			<div className="space-y-10 py-10">
				{dataToDisplay.map((data) => (
					<div key={data.heading}>
						<h2 className="text-center text-2xl sm:text-3xl">{data.heading}</h2>
						<div className="mx-auto grid items-start gap-8 sm:max-w-4xl sm:grid-cols-2 lg:max-w-5xl lg:grid-cols-3">
							{data.features.map((f) => (
								<div
									className="flex items-center justify-center gap-x-3 m-auto"
									key={f.text}
								>
									<f.icon className="size-6 flex-none" />
									<p className="text-muted-foreground">{f.text}</p>
								</div>
							))}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

const dataToDisplay = [
	{
		heading: "Media Tracking",
		features: [
			{
				icon: LucideNotebookTabs,
				text: "Track your progress for media (movies, shows, books, podcasts, games, anime, manga, music, visual novels)",
			},
			{
				icon: LucideLibraryBig,
				text: "Add media to your watchlist, favorite or any other custom collection",
			},
			{
				icon: LucideNotebookPen,
				text: "Track media you've watched and mark them as seen as many times as you want",
			},
			{
				icon: LucideImport,
				text: "Import your data from 13 different sources (with more to come)",
			},
			{
				icon: LucideRefreshCcwDot,
				text: "Integrations with 10 different services (with more on the way)",
			},
			{
				icon: LucideChartColumnBig,
				text: "Consolidated activity and statistics graphs and views across all your media",
			},
			{
				icon: LucideMegaphone,
				text: "Get notifications when a new episode is released or your favorite actor is back on screen",
			},
			{
				icon: LucideVibrate,
				text: "Support for 9 different notification platforms (more being released soon)",
			},
			{
				icon: LucideBellDot,
				text: "Set reminders for when you want to watch something and get notified",
			},
			{
				icon: LucideMessageSquareText,
				text: "Review media privately or publicly and see what others think",
			},
			{
				icon: LucideProjector,
				text: "Get information on where you can watch a movie/show legally in your country",
			},
			{
				icon: LucidePackageOpen,
				text: "Browse media by genre or groups (eg: Star Wars collection)",
			},
			{
				icon: LucideCalendarRange,
				text: "Calendar view to get an overview on when a media is coming out",
			},
			{
				icon: LucideCandy,
				text: "Suggestions that cater to your tastes based on your watch history",
			},
		],
	},
	{
		heading: "Fitness Tracking",
		features: [
			{
				icon: LucideDumbbell,
				text: "Hit the gym and track workouts in realtime",
			},
			{
				icon: LucideDatabaseZap,
				text: "Dataset of over 800 exercises with instructions (and the ability to add your own)",
			},
			{
				icon: LucideTimer,
				text: "Add rest timers to each set you complete",
			},
			{
				icon: LucideImageUp,
				text: "Create supersets and upload images for each exercise to track progression",
			},
			{
				icon: LucideSquareStack,
				text: "Inline history and images of exercises while logging an active workout",
			},
			{
				icon: LucideLayoutTemplate,
				text: "Create templates to pre plan workouts beforehand",
			},
			{
				icon: LucideChartLine,
				text: "Graphs of progress for exercises to visualize your progress over time",
			},
			{
				icon: LucideRuler,
				text: "Keep track of your measurements like body weight, sugar level etc.",
			},
			{
				icon: LucideScale3D,
				text: "Visualizations of how your measurements fluctuate over time. Use them to identify trends and patterns.",
			},
		],
	},
];
