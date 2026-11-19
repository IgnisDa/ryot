import { PluginLink, type TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import { useFormatters, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";

import { fitnessRoute } from "../../shared/workout-editor-routes";
import { useFitnessMessages } from "../messages";
import { buildTemplateCards } from "./model";
import { homeTemplatesQuery } from "./queries";
import { Chips, HomeSection, primaryLinkClass, QueryBody, SavedViewLink } from "./section";

export function TemplatesSection(props: { readonly now: Date; readonly timeZone: TimeZone }) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const result = useRyotQuery(homeTemplatesQuery);
	return (
		<HomeSection
			id="templates-heading"
			hint={text("client.home.templates-hint")}
			title={text("client.home.templates-title")}
			link={
				<SavedViewLink slug="all-workout-templates">
					{text("client.home.templates-all")}
				</SavedViewLink>
			}
		>
			<QueryBody result={result} noun="templates">
				{(data) => (
					<div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
						{buildTemplateCards(formatters, text, { ...data, ...props }).map((template, index) => (
							<article
								key={template.id}
								className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-surface p-4"
							>
								<div className="flex items-baseline justify-between gap-2">
									<h3 className="truncate text-[15px] font-semibold text-text">{template.name}</h3>
									<span
										className={clsx(
											"shrink-0 text-[12px] text-text-muted",
											index === 0 && "font-semibold text-accent-text",
										)}
									>
										{template.last}
									</span>
								</div>
								<span className="text-[12.5px] text-text-muted">{template.meta}</span>
								<Chips names={template.chips} more={template.moreChips} />
								<PluginLink
									className={clsx(primaryLinkClass, "mt-auto self-start")}
									to={fitnessRoute(`/templates/${encodeURIComponent(template.id)}/start`)}
									aria-label={text("client.home.template-start-label", { name: template.name })}
								>
									<AppIcon size={14} name="play" />
									{text("client.home.template-start")}
								</PluginLink>
							</article>
						))}
						<PluginLink
							to={fitnessRoute("/templates/new")}
							className="flex min-h-32 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-emphasis text-[13px] font-medium text-text-muted"
						>
							<AppIcon size={18} name="plus" />
							<span>{text("client.home.setup.template-action")}</span>
						</PluginLink>
					</div>
				)}
			</QueryBody>
		</HomeSection>
	);
}
