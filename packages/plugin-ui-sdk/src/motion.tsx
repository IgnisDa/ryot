import {
	AnimatePresence,
	motion,
	useIsPresent,
	useReducedMotion,
	type Transition,
} from "motion/react";
import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";

export const motionTransition = { duration: 0.2, ease: [0.2, 0.7, 0.2, 1] } satisfies Transition;

export function MotionPresence({ children }: { readonly children: ReactNode }) {
	return (
		<AnimatePresence propagate initial={false}>
			{children}
		</AnimatePresence>
	);
}

export function MotionScrollRoot(
	props: Pick<ComponentProps<typeof motion.div>, "children" | "ref" | "style" | "className">,
) {
	return <motion.div layoutScroll data-motion-scroll-root {...props} />;
}

function ListItem({ children }: { readonly children: ReactNode }) {
	const present = useIsPresent();
	const reduced = useReducedMotion();
	return (
		<motion.div
			inert={!present}
			layout="position"
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ height: 0, opacity: 0 }}
			aria-hidden={present ? undefined : true}
			className="min-w-0 motion-reduce:transform-none"
			transition={reduced ? { duration: 0 } : motionTransition}
		>
			{children}
		</motion.div>
	);
}

export function MotionList(props: { readonly children: ReactNode; readonly className?: string }) {
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

function CollapseContent(props: { readonly children: ReactNode; readonly swap?: boolean }) {
	const reduced = useReducedMotion();
	const present = useIsPresent();
	return (
		<motion.div
			inert={!present}
			aria-hidden={!present}
			exit={{ height: 0, opacity: 0 }}
			initial={{ height: 0, opacity: 0 }}
			animate={{ opacity: 1, height: "auto" }}
			transition={reduced ? { duration: 0 } : motionTransition}
			className="min-w-0 overflow-hidden motion-reduce:transform-none"
			style={props.swap && !present ? { inset: 0, position: "absolute" } : {}}
		>
			{props.children}
		</motion.div>
	);
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

export function useMotionPreference() {
	return useReducedMotion() === true;
}
