import { changeCase } from "@ryot/ts-utils";
import { IconPlayerPlay } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";
import { $path } from "safe-routes";
import type { TPrices } from "../config.server";
import { Button } from "./ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "./ui/tooltip";

export default function Pricing(props: {
	prices: TPrices;
	isLoggedIn?: boolean;
	onClick?: (priceId: string) => void;
}) {
	const [selectedProductTypeIndex, setSelectedProductTypeIndex] = useState(0);
	const selectedProductType = props.prices[selectedProductTypeIndex];

	return (
		<section id="pricing" className="w-full py-12 md:py-24 lg:py-32 bg-muted">
			<div className="container space-y-12 px-4 md:px-6">
				<div className="flex flex-col items-center justify-center space-y-4 text-center">
					<div className="space-y-2">
						<div className="inline-block rounded-lg bg-white px-3 py-1 text-sm">
							Pricing
						</div>
						<h2 className="text-3xl font-bold tracking-tighter sm:text-5xl">
							Simple, Transparent Pricing
						</h2>
						<p className="max-w-[900px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
							Ryot Pro is available in two product types:{" "}
							<ProductType
								title="Cloud"
								description="Hosted on our secure servers, with automatic updates and backups."
								onClick={() => setSelectedProductTypeIndex(0)}
							/>{" "}
							and{" "}
							<ProductType
								title="Self Hosted"
								description="Hosted on your own server, with full control over your data."
								onClick={() => setSelectedProductTypeIndex(1)}
							/>
							. Choose the one that best fits your needs.
						</p>
					</div>
				</div>
				<div className="space-y-4">
					<p className="text-center">
						You have chosen:{" "}
						<span className="underline">
							{changeCase(selectedProductType.type)}
						</span>
						.{" "}
						{selectedProductType.type === "self_hosted" ? (
							<Link to={$path("/features")} className="text-blue-400 underline">
								See differences.
							</Link>
						) : null}
					</p>
					<div className="mx-auto flex justify-center items-center gap-8 text-center flex-wrap">
						{selectedProductType.prices.map((p) => (
							<div
								className="grid gap-y-3 border rounded-xl py-3 w-72 bg-white"
								key={p.name}
							>
								<p className="text-3xl">{changeCase(p.name)}</p>
								<p className="text-xl font-bold text-muted-foreground">
									{p.amount ? `$${p.amount}` : "Community Edition"}
									{p.trial ? ` with a ${p.trial} days trial` : null}
								</p>
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
									<Button variant="outline" size="sm">
										<IconPlayerPlay size={16} className="mr-2" />
										<span>
											{props.isLoggedIn ? "Choose this" : "Get started"}
										</span>
									</Button>
								</Link>
							</div>
						))}
					</div>
				</div>
			</div>
		</section>
	);
}

type ProductTypeProps = {
	title: string;
	description: string;
	onClick: () => void;
};

const ProductType = ({ title, description, onClick }: ProductTypeProps) => (
	<TooltipProvider>
		<Tooltip>
			<TooltipTrigger className="text-blue-400" onClick={onClick}>
				{title}
			</TooltipTrigger>
			<TooltipContent>{description}</TooltipContent>
		</Tooltip>
	</TooltipProvider>
);
