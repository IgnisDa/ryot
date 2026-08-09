import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";

export function AuthStatus(props: { title: string; message: string; actions?: React.ReactNode }) {
	usePageTitle(props.title);
	return (
		<main {...mainContentProps} className="ui-page">
			<section
				aria-labelledby="auth-status-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				<div>
					<h1 id="auth-status-title" className="ui-heading">
						{props.title}
					</h1>
					<p role="status" className="ui-subtitle">
						{props.message}
					</p>
				</div>
				{props.actions && <div className="ui-stack">{props.actions}</div>}
			</section>
		</main>
	);
}
