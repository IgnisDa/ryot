import { PluginLink } from "@ryot-app/plugin-client-sdk/plugin";
import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";

import { fitnessRoute } from "../../shared/workout-editor-routes";
import { buildTemplateCards } from "./model";
import { homeTemplatesQuery } from "./queries";
import { Chips, HomeSection, primaryLinkClass, QueryBody, SavedViewLink } from "./section";

export function TemplatesSection(props: { readonly now: Date; readonly timeZone: string }) {
	const result = useRyotQuery(homeTemplatesQuery);
	return (
		<HomeSection
			id="templates-heading"
			title="Start from a template"
			hint="Longest since last done first"
			link={<SavedViewLink slug="all-workout-templates">All templates</SavedViewLink>}
		>
			<QueryBody result={result} noun="templates">
				{(data) => (
					<div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
						{buildTemplateCards({ ...data, ...props }).map((template, index) => (
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
									aria-label={`Start ${template.name}`}
									className={clsx(primaryLinkClass, "mt-auto self-start")}
									to={fitnessRoute(`/templates/${encodeURIComponent(template.id)}/start`)}
								>
									<AppIcon size={14} name="play" />
									Start
								</PluginLink>
							</article>
						))}
						<PluginLink
							to={fitnessRoute("/templates/new")}
							className="flex min-h-32 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-emphasis text-[13px] font-medium text-text-muted"
						>
							<AppIcon size={18} name="plus" />
							<span>New template</span>
						</PluginLink>
					</div>
				)}
			</QueryBody>
		</HomeSection>
	);
}
