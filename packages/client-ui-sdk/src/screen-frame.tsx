import clsx from "clsx";
import { useEffect, useState, type ComponentProps, type ReactNode, type RefObject } from "react";

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
	readonly width?: "full" | "readable";
	readonly scrollRootRef: RefObject<HTMLElement | null>;
};

type ScreenBarButtonProps = ComponentProps<"button"> & { readonly label: string };

const fade = "transition-opacity duration-150 ease-out motion-reduce:transition-none";

const barControl = "flex size-11 shrink-0 items-center justify-center rounded-pill";

export function ScreenBarButton({ label, className, ...props }: ScreenBarButtonProps) {
	return (
		<button type="button" aria-label={label} className={clsx(barControl, className)} {...props} />
	);
}

export function ScreenFrame({
	meta,
	hero,
	title,
	width,
	compact,
	leading,
	actions,
	children,
	searchRow,
	titleIcon,
	barActions,
	safeAreaTop,
	scrollRootRef,
}: ScreenFrameProps) {
	const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
	const [isScrolled, setIsScrolled] = useState(false);
	const hasTitleBlock = searchRow === undefined;
	const collapsible = hero !== undefined || hasTitleBlock;
	const column = width === "readable" ? "mx-auto w-full max-w-2xl" : undefined;

	useEffect(() => {
		if (!compact) {
			setIsScrolled(false);
			return undefined;
		}
		if (sentinel === null || typeof IntersectionObserver !== "function") {
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
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [compact, safeAreaTop, scrollRootRef, sentinel]);

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
			<>
				{hero}
				<div className={clsx("px-8", hero === undefined && "pt-8")}>
					<div className={column}>
						<header className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
							<div className="grid min-w-0 grow basis-72 gap-1">
								{heading}
								{meta}
							</div>
							{actions}
						</header>
						{children}
					</div>
				</div>
			</>
		);
	}

	return (
		<>
			<div
				data-testid="screen-frame-bar"
				style={{ paddingTop: safeAreaTop }}
				className="group sticky top-0 z-20 shrink-0"
				data-solid={isScrolled || searchRow !== undefined ? "" : undefined}
			>
				<div
					aria-hidden="true"
					className={clsx(
						"absolute inset-0 border-b border-border bg-bg opacity-0 group-data-[solid]:opacity-100",
						fade,
					)}
				/>
				<div
					className="relative flex items-center gap-1.5 px-4"
					style={{ height: SCREEN_BAR_HEIGHT }}
				>
					{searchRow ?? (
						<>
							{leading}
							<span
								aria-hidden="true"
								className="min-w-0 flex-1 translate-y-1.5 truncate font-ui text-[19px] font-semibold text-text opacity-0 transition-[opacity,transform] duration-150 ease-out group-data-[solid]:translate-y-0 group-data-[solid]:opacity-100 motion-reduce:transition-none"
							>
								{title}
							</span>
							{barActions}
						</>
					)}
				</div>
			</div>
			{hero !== undefined && (
				<div style={{ marginTop: -(safeAreaTop + SCREEN_BAR_HEIGHT) }}>{hero}</div>
			)}
			<div className={column}>
				{hasTitleBlock ? (
					<div className="grid gap-1 px-4 pb-4">
						{heading}
						{meta}
					</div>
				) : (
					<h1 className="sr-only">{title}</h1>
				)}
				{collapsible && <div ref={setSentinel} aria-hidden="true" className="h-px" />}
				<div className={clsx("px-4", !hasTitleBlock && "pt-4")}>{children}</div>
			</div>
		</>
	);
}
