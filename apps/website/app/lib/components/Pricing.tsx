import { changeCase, cn } from "@ryot/ts-utils";
import {
	CheckCircle,
	Cloud,
	Crown,
	PlayIcon,
	Server,
	Sparkles,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { $path } from "safe-routes";
import type { TPrices } from "../config.server";
import { getIcon, getIconBg, isPopular } from "./pricing-utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export default function Pricing(props: {
	prices: TPrices;
	isLoggedIn?: boolean;
	onClick?: (priceId: string) => void;
}) {
	const [selectedProductTypeIndex, setSelectedProductTypeIndex] = useState(0);
	const selectedProductType = props.prices[selectedProductTypeIndex];

	const isThreeColumn = selectedProductType.prices.length === 3;
	const isCloudType = selectedProductType.type === "cloud";
	const isSelfHosted = selectedProductType.type === "self_hosted";

	const getProductTypeButtonClass = (index: number) =>
		cn(
			"inline-flex items-center gap-1 underline hover:no-underline transition-colors",
			selectedProductTypeIndex === index
				? "text-primary font-medium"
				: "text-blue-500",
		);

	const getColorThemeClasses = (cloudClass: string, selfHostedClass: string) =>
		isCloudType ? cloudClass : selfHostedClass;

	return (
		<section id="pricing" className="py-20 relative overflow-hidden">
			<div className="absolute inset-0 bg-linear-to-br from-primary/5 via-transparent to-accent/5" />
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
				<div className="text-center mb-16">
					<Badge variant="outline" className="mb-4">
						<Sparkles className="w-4 h-4 mr-2" />
						Pricing
					</Badge>
					<h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-6">
						Choose Your Perfect Plan
					</h2>
					<p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
						Ryot Pro is available in two product types:{" "}
						<button
							type="button"
							className={getProductTypeButtonClass(0)}
							onClick={() => setSelectedProductTypeIndex(0)}
						>
							<Cloud className="w-4 h-4" />
							Cloud
						</button>{" "}
						and{" "}
						<button
							type="button"
							className={getProductTypeButtonClass(1)}
							onClick={() => setSelectedProductTypeIndex(1)}
						>
							<Server className="w-4 h-4" />
							Self Hosted
						</button>
						. Choose the one that best fits your needs.
					</p>

					<div className="flex items-center justify-center gap-4">
						<div className="flex items-center gap-2 bg-muted/50 px-4 py-2 rounded-full">
							<span className="text-muted-foreground">You have chosen:</span>
							<div className="flex items-center gap-1 text-primary font-medium">
								{isCloudType ? (
									<Cloud className="w-4 h-4" />
								) : (
									<Server className="w-4 h-4" />
								)}
								{changeCase(selectedProductType.type)}
							</div>
						</div>
						{isSelfHosted ? (
							<Link
								to={$path("/features")}
								className="text-blue-500 underline hover:no-underline transition-colors"
							>
								See differences
							</Link>
						) : null}
					</div>
				</div>

				<div className="max-w-6xl mx-auto mb-8">
					<div
						className={cn(
							"grid gap-6 mx-auto",
							isThreeColumn
								? "md:grid-cols-3 max-w-5xl"
								: "md:grid-cols-4 max-w-6xl",
						)}
					>
						{selectedProductType.prices.map((p) => (
							<Card
								key={p.name}
								className={cn(
									"border-2 rounded-xl transition-all duration-300 hover:shadow-lg hover:-translate-y-1",
									isPopular(p.name)
										? "border-primary/50 relative hover:border-primary/70 hover:shadow-xl hover:-translate-y-2 bg-linear-to-b from-primary/5 to-transparent"
										: "hover:border-primary/30",
								)}
							>
								{isPopular(p.name) && (
									<div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
										<Badge className="bg-linear-to-r from-orange-500 to-pink-500 text-white border-0">
											<Crown className="w-4 h-4 mr-1" />
											Most Popular
										</Badge>
									</div>
								)}
								<CardHeader
									className={cn(
										"text-center pt-8",
										isThreeColumn ? "pb-6" : "pb-4",
									)}
								>
									<div
										className={cn(
											isThreeColumn ? "w-12 h-12" : "w-10 h-10",
											getIconBg(p.name),
											"rounded-full flex items-center justify-center mx-auto",
											isThreeColumn ? "mb-4" : "mb-3",
										)}
									>
										{getIcon(p.name)}
									</div>
									<CardTitle
										className={cn(
											isThreeColumn ? "text-2xl" : "text-lg",
											isThreeColumn ? "mb-4" : "mb-3",
										)}
									>
										{changeCase(p.name)}
									</CardTitle>
									{p.amount ? (
										<div
											className={cn(
												"flex items-center justify-center",
												isThreeColumn && "mb-2",
											)}
										>
											<span
												className={cn(
													isThreeColumn ? "text-4xl" : "text-2xl",
													"font-bold text-foreground",
												)}
											>
												${p.amount}
											</span>
											{p.name.toLowerCase() === "monthly" && (
												<span className="text-muted-foreground ml-2">
													/month
												</span>
											)}
											{p.name.toLowerCase() === "yearly" && (
												<span className="text-muted-foreground ml-2">
													/year
												</span>
											)}
										</div>
									) : (
										<div className="text-xs text-muted-foreground">
											Community Edition
										</div>
									)}
									{p.trial && (
										<div
											className={cn(
												isThreeColumn ? "text-sm" : "text-xs",
												"text-muted-foreground",
											)}
										>
											{isPopular(p.name) && (
												<>
													<span className="bg-green-100 text-green-700 px-2 py-1 rounded-full text-xs">
														Save 17%
													</span>
													<br />
												</>
											)}
											with a {p.trial} days trial
										</div>
									)}
									{p.name.toLowerCase() === "lifetime" && (
										<div
											className={cn(
												isThreeColumn ? "text-sm" : "text-xs",
												"text-muted-foreground",
											)}
										>
											One-time payment
										</div>
									)}
								</CardHeader>
								<CardContent>
									<Link
										target={p.linkToGithub ? "_blank" : undefined}
										to={
											p.linkToGithub
												? "https://docs.ryot.io"
												: props.isLoggedIn
													? $path("/me")
													: "#start-here"
										}
										onClick={(e) => {
											if (props.onClick && p.priceId) {
												e.preventDefault();
												props.onClick(p.priceId);
											}
										}}
									>
										<Button
											variant={isPopular(p.name) ? "default" : "outline"}
											className={cn(
												"w-full",
												!isThreeColumn && "text-sm",
												isPopular(p.name) &&
													"bg-linear-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary",
											)}
										>
											<PlayIcon size={16} className="mr-2" />
											<span>
												{props.isLoggedIn ? "Choose this" : "Get started"}
											</span>
										</Button>
									</Link>
								</CardContent>
							</Card>
						))}
					</div>
				</div>

				<div
					className={cn(
						"max-w-4xl mx-auto p-8 rounded-2xl border",
						getColorThemeClasses(
							"bg-linear-to-r from-blue-50 to-indigo-50 border-blue-200",
							"bg-linear-to-r from-green-50 to-emerald-50 border-green-200",
						),
					)}
				>
					<div className="text-center">
						<div className="flex items-center justify-center gap-3 mb-4">
							<div
								className={cn(
									"w-10 h-10 rounded-full flex items-center justify-center",
									getColorThemeClasses("bg-blue-100", "bg-green-100"),
								)}
							>
								<CheckCircle
									className={cn(
										"w-6 h-6",
										getColorThemeClasses("text-blue-600", "text-green-600"),
									)}
								/>
							</div>
							<span
								className={cn(
									"text-xl font-semibold",
									getColorThemeClasses("text-blue-900", "text-green-900"),
								)}
							>
								All Pro Features Included
							</span>
						</div>
						<p
							className={cn(
								"max-w-2xl mx-auto leading-relaxed",
								getColorThemeClasses("text-blue-700", "text-green-700"),
							)}
						>
							With any paid {isCloudType ? "cloud" : "self-hosted"} plan, you
							get access to all Pro features.{" "}
							{isCloudType
								? "The only difference is the payment frequency and trial period - choose what works best for you."
								: "The only difference is the payment frequency - choose what works best for you."}
						</p>
					</div>
				</div>
			</div>
		</section>
	);
}
