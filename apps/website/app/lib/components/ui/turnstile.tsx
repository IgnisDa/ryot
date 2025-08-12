import { Turnstile } from "@marsidev/react-turnstile";
import { forwardRef } from "react";

export interface TurnstileProps {
	siteKey: string;
	className?: string;
	onError?: () => void;
	onExpire?: () => void;
	size?: "normal" | "compact";
	theme?: "light" | "dark" | "auto";
	onSuccess?: (token: string) => void;
}

const TurnstileWidget = forwardRef<HTMLDivElement, TurnstileProps>(
	(props, ref) => {
		return (
			<div ref={ref} className={props.className}>
				<Turnstile
					siteKey={props.siteKey}
					onError={props.onError}
					onExpire={props.onExpire}
					onSuccess={props.onSuccess}
					options={{
						theme: props.theme || "auto",
						size: props.size || "normal",
					}}
				/>
			</div>
		);
	},
);

TurnstileWidget.displayName = "TurnstileWidget";

export { TurnstileWidget };
