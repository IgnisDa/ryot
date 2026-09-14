export const MAIN_CONTENT_ID = "main-content";

export const mainContentProps = { tabIndex: -1, id: MAIN_CONTENT_ID } as const;

export function SkipToContentLink() {
	return (
		<a
			href={`#${MAIN_CONTENT_ID}`}
			className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:border focus:border-border-strong focus:bg-surface focus:px-4 focus:py-2.5 focus:font-semibold focus:text-text focus:shadow-card"
		>
			Skip to content
		</a>
	);
}
