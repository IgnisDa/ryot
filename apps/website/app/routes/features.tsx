import type { LoaderFunctionArgs, MetaArgs } from "@remix-run/node";
import clsx from "clsx";
import {
	LucideAmpersands,
	LucideBadgeInfo,
	LucideBellDot,
	LucideBookHeart,
	LucideCalendarRange,
	LucideCandy,
	LucideChartColumnBig,
	LucideChartLine,
	LucideCog,
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
	LucideShare,
	LucideSquareStack,
	LucideTimer,
	LucideVibrate,
	LucideWatch,
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
			{dataToDisplay.map((data, index) => (
				<div
					key={data.heading}
					className={clsx(
						"py-10 space-y-8",
						index % 2 === 1 ? "bg-muted" : "bg-white",
					)}
				>
					<h2 className="text-center text-2xl sm:text-3xl font-semibold lowercase">
						{data.heading}
					</h2>
					<div className="mx-auto grid items-start gap-8 sm:max-w-4xl sm:grid-cols-2 lg:max-w-5xl lg:grid-cols-3">
						{data.features.map((f) => (
							<div
								className="flex items-center justify-center gap-x-3 h-full"
								key={f.text}
							>
								<div
									className={clsx(
										f.isPro && "border border-green-400 rounded-md p-2",
									)}
								>
									<f.icon className="size-6 flex-none mx-auto" />
									{f.isPro ? (
										<div className="text-green-700 text-xs mt-2 text-center">
											Pro
										</div>
									) : null}
								</div>
								<p className="text-muted-foreground">{f.text}</p>
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

const dataToDisplay = [
	{
		heading: "Media Tracking",
		features: [
			{
				icon: LucideNotebookTabs,
				text: "Track everything you want: movies, shows, books, podcasts, games, anime, manga, music, visual novels",
			},
			{
				icon: LucideLibraryBig,
				text: "Add media to your watchlist, favorite or any other custom collection",
			},
			{
				icon: LucideBookHeart,
				text: "Get recommendations based on your favorites and watch history",
				isPro: true,
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
				icon: LucideWatch,
				text: "Set time spent manually on seen entries for more accurate tracking of media consumption",
				isPro: true,
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
				isPro: true,
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
	{
		heading: "Other Goodies",
		features: [
			{
				icon: LucideShare,
				text: "Share access links to your data with your friends and family",
				isPro: true,
			},
			{
				icon: LucideCog,
				text: "Fine grained preferences to customize exactly what you want to track",
			},
			{
				icon: LucideAmpersands,
				text: "Add collaborators to your collections to allow them to add to them",
				isPro: true,
			},
			{
				icon: LucideBadgeInfo,
				text: "Add custom information to your collections to make them more personalized",
				isPro: true,
			},
		],
	},
];
