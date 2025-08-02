import Autoplay from "embla-carousel-autoplay";
import {
	AreaChart,
	ArrowRight,
	BarChart3,
	Bell,
	Brain,
	CheckCircle,
	Crown,
	Dumbbell,
	Film,
	FolderHeart,
	Heart,
	Lock,
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
	LucideRouter,
	LucideRuler,
	LucideScale3D,
	LucideShare,
	LucideSquareStack,
	LucideTimer,
	LucideToggleLeft,
	LucideVibrate,
	LucideWatch,
	Play,
	Share2,
	Sparkles,
	Target,
	Users,
} from "lucide-react";
import { Link } from "react-router";
import { $path } from "safe-routes";
import { withFragment } from "ufo";
import { Badge } from "~/lib/components/ui/badge";
import { Button } from "~/lib/components/ui/button";
import { Card, CardContent } from "~/lib/components/ui/card";
import {
	Carousel,
	CarouselContent,
	CarouselItem,
} from "~/lib/components/ui/carousel";
import { ProBadge } from "~/lib/components/ui/pro-badge";

export const meta = () => {
	return [{ title: "Features | Ryot" }];
};

const CARD_HOVER_STYLES =
	"hover:shadow-lg transition-all duration-300 hover:-translate-y-1";

const FeatureItem = (props: {
	children: React.ReactNode;
	isPro?: boolean;
}) => (
	<div className="flex items-start space-x-3 p-3 rounded-lg hover:bg-muted/30 transition-colors">
		<CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
		<div className="flex items-start flex-wrap gap-1">
			<span className="text-foreground leading-relaxed">{props.children}</span>
			{props.isPro && <ProBadge />}
		</div>
	</div>
);

export default function Page() {
	return (
		<div className="min-h-screen">
			{/* Hero Section */}
			<section className="py-20 lg:py-32">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
					<div className="text-center mb-16">
						<Badge variant="secondary" className="mb-6">
							<Brain className="w-4 h-4 mr-2" />
							Comprehensive Tracking
						</Badge>
						<h1 className="text-4xl lg:text-6xl font-bold text-foreground mb-6 leading-tight">
							Think of Ryot as your{" "}
							<span className="text-primary">second brain</span> with
							superpowers ✨
						</h1>
						<p className="text-lg text-muted-foreground max-w-3xl mx-auto leading-relaxed">
							What all can Ryot do for you?
						</p>
					</div>
				</div>
			</section>

			{/* Media Tracking Section */}
			<section className="py-20 bg-muted/30">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
					<div className="text-center mb-16">
						<Badge variant="outline" className="mb-6">
							<Film className="w-4 h-4 mr-2" />
							Media Tracking
						</Badge>
						<h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-8">
							Your Complete Media Universe
						</h2>
					</div>

					{/* Media Screenshots Carousel */}
					{dataToDisplay[0].images.length > 0 && (
						<div className="mb-16">
							<Carousel
								plugins={[Autoplay({ delay: 5000 })]}
								className="w-full max-w-5xl mx-auto"
							>
								<CarouselContent>
									{dataToDisplay[0].images.map((image, index) => (
										<CarouselItem
											key={image}
											className="flex flex-col space-y-4"
										>
											<img
												src={`/features/${image}`}
												alt={`Media tracking interface ${index + 1}`}
												className="mx-auto rounded-2xl max-h-96 md:max-h-[500px] lg:max-h-[600px] w-full object-contain"
											/>
										</CarouselItem>
									))}
								</CarouselContent>
							</Carousel>
						</div>
					)}

					<div className="grid lg:grid-cols-2 gap-2 mb-16">
						{dataToDisplay[0].features.map((feature) => (
							<FeatureItem key={feature.text} isPro={feature.isPro}>
								{feature.text}
							</FeatureItem>
						))}
					</div>
				</div>
			</section>

			{/* Fitness Tracking Section */}
			<section className="py-20">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
					<div className="text-center mb-16">
						<Badge variant="outline" className="mb-6">
							<Dumbbell className="w-4 h-4 mr-2" />
							Fitness Tracking
						</Badge>
						<h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-8">
							Transform Your Fitness Journey
						</h2>
					</div>

					{/* Fitness Screenshots Carousel */}
					{dataToDisplay[1].images.length > 0 && (
						<div className="mb-16">
							<div className="text-center mb-8">
								<h3 className="text-2xl font-semibold text-foreground mb-4">
									Comprehensive Exercise Database
								</h3>
								<p className="text-muted-foreground max-w-2xl mx-auto">
									Access over 800 exercises with detailed instructions, search
									functionality, and the ability to add your own custom
									exercises.
								</p>
							</div>
							<Carousel
								plugins={[Autoplay({ delay: 5000 })]}
								className="w-full max-w-5xl mx-auto"
							>
								<CarouselContent>
									{dataToDisplay[1].images.map((image, index) => (
										<CarouselItem
											key={image}
											className="flex flex-col space-y-4"
										>
											<img
												src={`/features/${image}`}
												alt={`Fitness tracking interface ${index + 1}`}
												className="mx-auto rounded-2xl max-h-96 md:max-h-[500px] lg:max-h-[600px] w-full object-contain"
											/>
										</CarouselItem>
									))}
								</CarouselContent>
							</Carousel>
						</div>
					)}

					<div className="grid lg:grid-cols-2 gap-2">
						{dataToDisplay[1].features
							.slice(0, Math.ceil(dataToDisplay[1].features.length / 2))
							.map((feature) => (
								<FeatureItem key={feature.text} isPro={feature.isPro}>
									{feature.text}
								</FeatureItem>
							))}
					</div>
				</div>
			</section>

			{/* Other Goodies Section */}
			<section className="py-20 bg-muted/30">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
					<div className="text-center mb-16">
						<Badge variant="outline" className="mb-6">
							<Sparkles className="w-4 h-4 mr-2" />
							Other Goodies
						</Badge>
						<h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-8">
							Even More Amazing Features
						</h2>
					</div>

					{/* Other Features Screenshots Carousel */}
					{dataToDisplay[2].images.length > 0 && (
						<div className="mb-16">
							<Carousel
								plugins={[Autoplay({ delay: 5000 })]}
								className="w-full max-w-5xl mx-auto"
							>
								<CarouselContent>
									{dataToDisplay[2].images.map((image, index) => (
										<CarouselItem
											key={image}
											className="flex flex-col space-y-4"
										>
											<img
												src={`/features/${image}`}
												alt={`Additional features interface ${index + 1}`}
												className="mx-auto rounded-2xl max-h-96 md:max-h-[500px] lg:max-h-[600px] w-full object-contain"
											/>
										</CarouselItem>
									))}
								</CarouselContent>
							</Carousel>
						</div>
					)}

					<div className="max-w-4xl mx-auto">
						<div className="space-y-2">
							{dataToDisplay[2].features.map((feature) => (
								<FeatureItem key={feature.text} isPro={feature.isPro}>
									{feature.text}
								</FeatureItem>
							))}
						</div>
					</div>
				</div>
			</section>

			{/* Feature Categories Grid */}
			<section className="py-20">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
					<div className="text-center mb-16">
						<h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-6">
							Everything You Need in One Place
						</h2>
						<p className="text-lg text-muted-foreground max-w-2xl mx-auto">
							Discover all the powerful features that make Ryot your ultimate
							personal tracking companion.
						</p>
					</div>

					<div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
						<Card className={CARD_HOVER_STYLES}>
							<CardContent className="p-6">
								<div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
									<Play className="w-6 h-6 text-blue-600" />
								</div>
								<h3 className="text-xl font-semibold mb-3">Smart Tracking</h3>
								<p className="text-muted-foreground mb-4">
									Automatically organize and categorize your media with
									intelligent detection and classification.
								</p>
								<div className="flex items-center text-sm text-blue-600">
									<CheckCircle className="w-4 h-4 mr-1" />
									Auto-classification
								</div>
							</CardContent>
						</Card>

						<Card className={CARD_HOVER_STYLES}>
							<CardContent className="p-6">
								<div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
									<BarChart3 className="w-6 h-6 text-green-600" />
								</div>
								<h3 className="text-xl font-semibold mb-3">
									Advanced Analytics
								</h3>
								<p className="text-muted-foreground mb-4">
									Get deep insights into your habits with beautiful charts and
									comprehensive statistics.
								</p>
								<div className="flex items-center text-sm text-green-600">
									<AreaChart className="w-4 h-4 mr-1" />
									Beautiful charts
								</div>
							</CardContent>
						</Card>

						<Card className={CARD_HOVER_STYLES}>
							<CardContent className="p-6">
								<div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
									<Bell className="w-6 h-6 text-purple-600" />
								</div>
								<h3 className="text-xl font-semibold mb-3">
									Smart Notifications
								</h3>
								<p className="text-muted-foreground mb-4">
									Never miss new releases or important updates with intelligent
									notification system.
								</p>
								<div className="flex items-center text-sm text-purple-600">
									<Target className="w-4 h-4 mr-1" />9 Platforms
								</div>
							</CardContent>
						</Card>

						<Card className={CARD_HOVER_STYLES}>
							<CardContent className="p-6">
								<div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mb-4">
									<Share2 className="w-6 h-6 text-orange-600" />
								</div>
								<h3 className="text-xl font-semibold mb-3">Social Features</h3>
								<p className="text-muted-foreground mb-4">
									Share your progress and collections with friends and family
									members.
								</p>
								<div className="flex items-center text-sm text-orange-600">
									<Users className="w-4 h-4 mr-1" />
									Share with friends
								</div>
							</CardContent>
						</Card>

						<Card className={CARD_HOVER_STYLES}>
							<CardContent className="p-6">
								<div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center mb-4">
									<Heart className="w-6 h-6 text-red-600" />
								</div>
								<h3 className="text-xl font-semibold mb-3">
									Personal Collections
								</h3>
								<p className="text-muted-foreground mb-4">
									Create custom collections and add personal touches to make
									them uniquely yours.
								</p>
								<div className="flex items-center text-sm text-red-600">
									<FolderHeart className="w-4 h-4 mr-1" />
									Custom collections
								</div>
							</CardContent>
						</Card>

						<Card className={CARD_HOVER_STYLES}>
							<CardContent className="p-6">
								<div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mb-4">
									<Lock className="w-6 h-6 text-gray-600" />
								</div>
								<h3 className="text-xl font-semibold mb-3">Privacy First</h3>
								<p className="text-muted-foreground mb-4">
									Your data stays secure with self-hosting options and complete
									privacy control.
								</p>
								<div className="flex items-center text-sm text-gray-600">
									<CheckCircle className="w-4 h-4 mr-1" />
									Self-hosted
								</div>
							</CardContent>
						</Card>
					</div>
				</div>
			</section>

			{/* Pro Features Callout */}
			<section className="py-20 bg-gradient-to-r from-orange-50 to-pink-50">
				<div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
					<div className="flex items-center justify-center gap-3 mb-6">
						<div className="w-12 h-12 bg-gradient-to-r from-orange-500 to-pink-500 rounded-full flex items-center justify-center">
							<Crown className="w-6 h-6 text-white" />
						</div>
						<span className="text-2xl font-bold text-foreground">
							Unlock Pro Features
						</span>
					</div>
					<p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto leading-relaxed">
						Get access to advanced analytics, custom collections, sharing
						features, and much more with Ryot Pro. Upgrade your tracking
						experience today.
					</p>
					<div className="flex flex-col sm:flex-row gap-4 justify-center">
						<Link to={withFragment($path("/"), "pricing")}>
							<Button size="lg">
								View Pricing Plans
								<ArrowRight className="w-4 h-4 ml-2" />
							</Button>
						</Link>
						<Button variant="outline" size="lg">
							Try Live Demo
						</Button>
					</div>
				</div>
			</section>
		</div>
	);
}

const dataToDisplay = [
	{
		heading: "Media Tracking",
		images: ["desktop.png", "genres.png", "group.png"],
		features: [
			{
				icon: LucideNotebookTabs,
				text: "Track everything you want: movies, shows, books, podcasts, games, anime, manga, music, visual novels",
			},
			{
				icon: LucideLibraryBig,
				text: "Add media to your watchlist, favorite or any other custom collection",
				isPro: true,
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
				text: "Import your data from 16 different sources (with more to come)",
			},
			{
				icon: LucideRefreshCcwDot,
				text: "Integrations with 13 different services (with more on the way)",
			},
			{
				icon: LucideChartColumnBig,
				text: "Consolidated activity and statistics graphs and views across all your media",
				isPro: true,
			},
			{
				icon: LucideWatch,
				text: "Set time spent manually on seen entries for more accurate tracking of media consumption",
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
				text: "Calendar view to get an overview on when a media is being released",
			},
			{
				icon: LucideCandy,
				text: "Suggestions that cater to your tastes based on your watch history",
				isPro: true,
			},
			{
				icon: LucideRouter,
				text: "Integrations with Youtube Music and Jellyfin for your music collection",
			},
		],
	},
	{
		heading: "Fitness Tracking",
		images: [
			"current-workout.png",
			"measurements-graph.png",
			"logged-workout.png",
			"exercise-dataset.png",
		],
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
				isPro: true,
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
	{
		heading: "Other Goodies",
		images: [
			"sharing.png",
			"recommendations.png",
			"sharing-form.png",
			"supercharged-collections.png",
		],
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
				icon: LucideToggleLeft,
				text: "Dark and light mode, because Ryot is at your fingertips the whole time",
			},
			{
				icon: LucideBadgeInfo,
				text: "Add custom information to your collections to make them more personalized",
				isPro: true,
			},
		],
	},
];
