import {
	AnimatePresence,
	motion,
	type Transition,
	useIsPresent,
	useReducedMotion,
} from "motion/react";
import { Children, type ComponentProps, isValidElement, type ReactNode } from "react";

export const motionTransition = { duration: 0.2, ease: [0.2, 0.7, 0.2, 1] } satisfies Transition;

export function usePrefersReducedMotion() {
	return useReducedMotion() === true;
}

export function useMotionTransition(): Transition {
	return useReducedMotion() === true ? { duration: 0 } : motionTransition;
}

export function MotionPresence({ children }: { readonly children: ReactNode }) {
	return (
		<AnimatePresence propagate initial={false}>
			{children}
		</AnimatePresence>
	);
}

export function MotionScrollRoot(
	props: Pick<ComponentProps<typeof motion.div>, "ref" | "style" | "children" | "className">,
) {
	return <motion.div layoutScroll data-scroll-root {...props} />;
}

export function Collapse(props: { readonly open: boolean; readonly children: ReactNode }) {
	return (
		<AnimatePresence initial={false}>
			{props.open ? <CollapseContent>{props.children}</CollapseContent> : null}
		</AnimatePresence>
	);
}

export function MotionSwap(props: { readonly stateKey: string; readonly children: ReactNode }) {
	return (
		<div className="relative min-w-0">
			<AnimatePresence initial={false}>
				<CollapseContent swap key={props.stateKey}>
					{props.children}
				</CollapseContent>
			</AnimatePresence>
		</div>
	);
}

export function MotionList(props: { readonly className?: string; readonly children: ReactNode }) {
	return (
		<div className={props.className}>
			<AnimatePresence initial={false}>
				{Children.toArray(props.children).map((child) =>
					isValidElement(child) ? <ListItem key={child.key}>{child}</ListItem> : child,
				)}
			</AnimatePresence>
		</div>
	);
}

function ListItem({ children }: { readonly children: ReactNode }) {
	const present = useIsPresent();
	const transition = useMotionTransition();
	return (
		<motion.div
			inert={!present}
			layout="position"
			transition={transition}
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ height: 0, opacity: 0 }}
			aria-hidden={present ? undefined : true}
			style={present ? {} : { overflow: "hidden" }}
			className="min-w-0 motion-reduce:transform-none"
		>
			{children}
		</motion.div>
	);
}

function CollapseContent(props: { readonly swap?: boolean; readonly children: ReactNode }) {
	const transition = useMotionTransition();
	const present = useIsPresent();
	return (
		<motion.div
			inert={!present}
			aria-hidden={!present}
			transition={transition}
			exit={{ height: 0, opacity: 0 }}
			initial={{ height: 0, opacity: 0 }}
			animate={{ opacity: 1, height: "auto" }}
			className="min-w-0 overflow-hidden motion-reduce:transform-none"
			style={props.swap && !present ? { inset: 0, position: "absolute" } : {}}
		>
			{props.children}
		</motion.div>
	);
}
