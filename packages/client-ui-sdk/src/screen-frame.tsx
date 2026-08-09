import clsx from "clsx";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

export const SCREEN_BAR_HEIGHT = 54;

type ScreenFrameProps = {
	readonly title: string;
	readonly compact: boolean;
	readonly meta?: ReactNode;
	readonly hero?: ReactNode;
	readonly children: ReactNode;
	readonly leading?: ReactNode;
	readonly actions?: ReactNode;
	readonly safeAreaTop: number;
	readonly searchRow?: ReactNode;
	readonly titleIcon?: ReactNode;
	readonly barActions?: ReactNode;
	readonly headerClassName?: string | undefined;
	readonly columnClassName?: string | undefined;
	readonly contentClassName?: string | undefined;
	readonly scrollRootRef: RefObject<HTMLElement | null>;
};

const fade = "transition-opacity duration-150 ease-out motion-reduce:transition-none";

export function ScreenFrame({
	meta,
	hero,
	title,
	compact,
	leading,
	actions,
	children,
	searchRow,
	titleIcon,
	barActions,
	safeAreaTop,
	scrollRootRef,
	headerClassName,
	columnClassName,
	contentClassName,
}: ScreenFrameProps) {
	const sentinel = useRef<HTMLDivElement>(null);
	const [isScrolled, setIsScrolled] = useState(false);
	const hasTitleBlock = searchRow === undefined;
	const collapsible = hero !== undefined || hasTitleBlock;

	useEffect(() => {
		if (!compact) {
			setIsScrolled(false);
			return undefined;
		}
		const target = sentinel.current;
		if (target === null || typeof IntersectionObserver !== "function") {
			return undefined;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				const entry = entries.at(-1);
				if (entry !== undefined) {
					setIsScrolled(!entry.isIntersecting);
				}
			},
			{
				threshold: 0,
				root: scrollRootRef.current,
				rootMargin: `-${safeAreaTop + SCREEN_BAR_HEIGHT}px 0px 0px 0px`,
			},
		);
		observer.observe(target);
		return () => observer.disconnect();
	}, [compact, safeAreaTop, scrollRootRef]);

	const heading = (
		<div className="flex min-w-0 items-center gap-2.5">
			{titleIcon}
			<h1
				className={clsx(
					"min-w-0 flex-1 truncate font-display font-semibold text-text",
					compact ? "text-[30px] leading-9" : "text-3xl",
				)}
			>
				{title}
			</h1>
		</div>
	);

	if (!compact) {
		return (
			<div className={columnClassName}>
				<header
					className={
						headerClassName ??
						"grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-6"
					}
				>
					<div className="grid min-w-0 gap-1">
						{heading}
						{meta}
					</div>
					{actions}
				</header>
				<div className={contentClassName}>{children}</div>
			</div>
		);
	}

	return (
		<>
			<div
				data-testid="screen-frame-bar"
				style={{ paddingTop: safeAreaTop }}
				data-scrolled={isScrolled ? "" : undefined}
				className="group sticky top-0 z-20 shrink-0"
			>
				<div
					aria-hidden="true"
					className={clsx(
						"absolute inset-0 border-b border-border bg-bg opacity-0 group-data-[scrolled]:opacity-100",
						fade,
					)}
				/>
				{searchRow ?? (
					<div
						className="relative flex items-center gap-1.5 px-4"
						style={{ height: SCREEN_BAR_HEIGHT }}
					>
						{leading}
						<span
							aria-hidden="true"
							className="min-w-0 flex-1 translate-y-1.5 truncate font-ui text-[19px] font-semibold text-text opacity-0 transition-[opacity,transform] duration-150 ease-out group-data-[scrolled]:translate-y-0 group-data-[scrolled]:opacity-100 motion-reduce:transition-none"
						>
							{title}
						</span>
						{barActions}
					</div>
				)}
			</div>
			{hero !== undefined && (
				<div style={{ marginTop: -(safeAreaTop + SCREEN_BAR_HEIGHT) }}>{hero}</div>
			)}
			<div className={columnClassName}>
				{hasTitleBlock && (
					<div className="grid gap-1 px-4 pb-2">
						{heading}
						{meta}
					</div>
				)}
				{collapsible && <div ref={sentinel} aria-hidden="true" className="h-px" />}
				<div className={contentClassName}>{children}</div>
			</div>
		</>
	);
}
