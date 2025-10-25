# Tailwind/shadcn to Mantine v9 Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate app-frontend from Tailwind CSS 4.2 + shadcn to Mantine v9 (beta) in a single comprehensive update.

**Architecture:** Remove all Tailwind/shadcn dependencies, install Mantine v9 beta packages, replace all 5 shadcn components with Mantine equivalents, convert all Tailwind classes to Mantine styling (combination of CSS Modules and inline styles), set up Mantine theme and dark mode.

**Tech Stack:** Mantine v9 beta (@mantine/core, @mantine/hooks), PostCSS, Vite, React 19, TanStack Start

---

## Task 1: Update package.json Dependencies

**Files:**
- Modify: `apps/app-frontend/package.json`

**Step 1: Remove Tailwind and shadcn dependencies**

Replace the entire dependencies and devDependencies sections in `apps/app-frontend/package.json`:

```json
{
	"dependencies": {
		"@better-auth/api-key": "1.5.0",
		"@mantine/core": "9.0.0-beta.22",
		"@mantine/hooks": "9.0.0-beta.22",
		"@tanstack/react-devtools": "0.9.6",
		"@tanstack/react-form": "1.28.3",
		"@tanstack/react-query": "5.90.21",
		"@tanstack/react-query-devtools": "5.91.3",
		"@tanstack/react-router": "1.163.3",
		"@tanstack/react-router-devtools": "1.163.3",
		"@tanstack/react-router-ssr-query": "1.163.3",
		"@tanstack/react-start": "1.165.0",
		"@tanstack/router-plugin": "1.164.0",
		"better-auth": "1.5.0",
		"openapi-fetch": "0.17.0",
		"openapi-react-query": "0.5.4",
		"postcss": "8.4.49",
		"postcss-preset-mantine": "1.18.3",
		"react": "19.2.4",
		"react-dom": "19.2.4"
	},
	"devDependencies": {
		"@tanstack/devtools-vite": "0.5.2",
		"@types/node": "22.10.2",
		"@types/react": "19.2.14",
		"@types/react-dom": "19.2.3",
		"@vitejs/plugin-react": "5.1.4",
		"openapi-typescript": "7.13.0",
		"typescript": "5.9.3",
		"vite": "7.3.1",
		"vite-tsconfig-paths": "6.1.1",
		"zod": "4.3.6"
	}
}
```

**Step 2: Install dependencies**

Run: `bun install`

Expected: Dependencies installed successfully, no errors

**Step 3: Commit dependency changes**

```bash
git add 'apps/app-frontend/package.json'
git commit -m 'refactor(app-frontend): replace Tailwind/shadcn with Mantine v9 dependencies'
```

---

## Task 2: Update Vite Configuration

**Files:**
- Modify: `apps/app-frontend/vite.config.ts`

**Step 1: Remove tailwindcss plugin from vite config**

Replace the plugins array in `apps/app-frontend/vite.config.ts`:

```typescript
const config = defineConfig({
	server: { host: true, port: 3005, strictPort: true, allowedHosts: true },
	plugins: [
		devtools(),
		createOpenApiTypesPlugin(),
		tsconfigPaths({ projects: ["./tsconfig.json"] }),
		tanstackStart({ spa: { enabled: true } }),
		viteReact(),
	],
});
```

**Step 2: Verify syntax**

Run: `bun run typecheck`

Expected: No TypeScript errors (may have unused import warnings, that's fine)

**Step 3: Commit vite config changes**

```bash
git add 'apps/app-frontend/vite.config.ts'
git commit -m 'refactor(app-frontend): remove Tailwind Vite plugin'
```

---

## Task 3: Replace styles.css

**Files:**
- Modify: `apps/app-frontend/src/styles.css`

**Step 1: Replace entire styles.css content**

Replace all content in `apps/app-frontend/src/styles.css`:

```css
@import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Manrope:wght@400;500;600;700;800&display=swap");
@import "@mantine/core/styles.css";

html,
body,
#app {
	min-height: 100%;
}
```

**Step 2: Commit styles changes**

```bash
git add 'apps/app-frontend/src/styles.css'
git commit -m 'refactor(app-frontend): replace Tailwind imports with Mantine styles'
```

---

## Task 4: Set Up Mantine in Root Document

**Files:**
- Modify: `apps/app-frontend/src/routes/__root.tsx`

**Step 1: Update imports and add MantineProvider**

Replace the entire content of `apps/app-frontend/src/routes/__root.tsx`:

```typescript
import { ColorSchemeScript, createTheme, MantineProvider } from "@mantine/core";
import { TanStackDevtools } from "@tanstack/react-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import type { AuthClient } from "#/hooks/auth";
import appCss from "../styles.css?url";

const theme = createTheme({
	primaryColor: "blue",
	defaultRadius: "md",
	fontFamily: "Manrope, sans-serif",
});

export const Route = createRootRouteWithContext<{
	authClientInstance: AuthClient;
}>()({
	ssr: false,
	shellComponent: RootDocument,
	head: () => ({
		links: [{ href: appCss, rel: "stylesheet" }],
		meta: [
			{ charSet: "utf-8" },
			{ title: "TanStack Start Starter" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
		],
	}),
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<ColorSchemeScript />
				<HeadContent />
			</head>
			<body>
				<MantineProvider theme={theme}>
					{children}
					<TanStackDevtools
						config={{ position: "bottom-right" }}
						plugins={[
							{
								name: "Tanstack Router",
								render: <TanStackRouterDevtoolsPanel />,
							},
						]}
					/>
				</MantineProvider>
				<Scripts />
			</body>
		</html>
	);
}
```

**Step 2: Verify types**

Run: `bun run typecheck`

Expected: No errors in __root.tsx

**Step 3: Commit root document changes**

```bash
git add 'apps/app-frontend/src/routes/__root.tsx'
git commit -m 'refactor(app-frontend): set up Mantine provider and theme in root document'
```

---

## Task 5: Update Form Components Hook

**Files:**
- Modify: `apps/app-frontend/src/hooks/forms.tsx`

**Step 1: Replace shadcn components with Mantine**

Replace the entire content of `apps/app-frontend/src/hooks/forms.tsx`:

```typescript
import { Button, Label, Text, TextInput } from "@mantine/core";
import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import type { ComponentPropsWithoutRef, HTMLInputTypeAttribute } from "react";

type TextFieldProps = {
	id?: string;
	label: string;
	className?: string;
	placeholder?: string;
	autoComplete?: string;
	type?: HTMLInputTypeAttribute;
};

function TextField(props: TextFieldProps) {
	const field = useFieldContext<string>();

	return (
		<div>
			<Label htmlFor={props.id}>{props.label}</Label>
			<TextInput
				id={props.id}
				error={!field.state.meta.isValid}
				value={field.state.value}
				onBlur={field.handleBlur}
				className={props.className}
				type={props.type ?? "text"}
				placeholder={props.placeholder}
				autoComplete={props.autoComplete}
				onChange={(event) => field.handleChange(event.target.value)}
			/>
			{!field.state.meta.isValid && (
				<Text c="red" size="xs">
					{field.state.meta.errors.map((e) => e?.message).join(", ")}
				</Text>
			)}
		</div>
	);
}

type SubmitButtonProps = {
	label: string;
	className?: string;
	disabled?: boolean;
	pendingLabel?: string;
} & Pick<ComponentPropsWithoutRef<typeof Button>, "variant">;

function SubmitButton(props: SubmitButtonProps) {
	const form = useFormContext();

	return (
		<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
			{([canSubmit, isSubmitting]) => (
				<Button
					type="submit"
					variant={props.variant}
					className={props.className}
					disabled={props.disabled || isSubmitting || !canSubmit}
				>
					{isSubmitting ? (props.pendingLabel ?? props.label) : props.label}
				</Button>
			)}
		</form.Subscribe>
	);
}

export const { fieldContext, useFieldContext, formContext, useFormContext } =
	createFormHookContexts();

export const { useAppForm } = createFormHook({
	formContext,
	fieldContext,
	fieldComponents: { TextField },
	formComponents: { SubmitButton },
});
```

**Step 2: Verify types**

Run: `bun run typecheck`

Expected: No errors in forms.tsx

**Step 3: Commit forms hook changes**

```bash
git add 'apps/app-frontend/src/hooks/forms.tsx'
git commit -m 'refactor(app-frontend): migrate form components to Mantine'
```

---

## Task 6: Update Start Page

**Files:**
- Modify: `apps/app-frontend/src/routes/start.tsx`

**Step 1: Replace with Mantine components**

Replace the entire content of `apps/app-frontend/src/routes/start.tsx`:

```typescript
import { Card, Center, Paper, Stack, Tabs, Text, Title } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { useAuthClient } from "#/hooks/auth";
import { useAppForm } from "#/hooks/forms";

const searchSchema = z.object({
	redirect: z.string().optional(),
});

export const Route = createFileRoute("/start")({
	component: StartPage,
	validateSearch: searchSchema,
});

const authModes = {
	login: {
		actionLabel: "Log In",
		title: "Welcome back",
		passwordAutoComplete: "current-password",
		subtitle: "Use your email and password to continue",
	},
	signup: {
		actionLabel: "Sign Up",
		title: "Create your account",
		passwordAutoComplete: "new-password",
		subtitle: "Use your email and password to sign up",
	},
} as const;

type AuthMode = keyof typeof authModes;

const getNameFromEmail = (email: string) => {
	const [localPart = ""] = email.split("@");
	const normalized = localPart.replace(/[._-]+/g, " ").trim();
	if (!normalized) return "New User";

	return normalized
		.split(/\s+/)
		.map((segment) => {
			if (!segment) return segment;
			return `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`;
		})
		.join(" ");
};

const schema = z.object({
	email: z.email().min(1, "Email is required"),
	password: z.string().min(8, "Password must be at least 8 characters"),
});

function StartPage() {
	const search = Route.useSearch();
	const authClient = useAuthClient();
	const navigate = Route.useNavigate();
	const [mode, setMode] = useState<AuthMode>("login");
	const [submitError, setSubmitError] = useState<string | null>(null);

	const authForm = useAppForm({
		validators: { onBlur: schema },
		defaultValues: { email: "", password: "" },
		onSubmit: async ({ value }) => {
			setSubmitError(null);

			const email = value.email.trim();
			const password = value.password;

			const response =
				mode === "login"
					? await authClient.signIn.email({ email, password })
					: await authClient.signUp.email({
							email,
							password,
							name: getNameFromEmail(email),
						});

			if (response.error) {
				setSubmitError(response.error.message || "An unknown error occurred");
				return;
			}

			await navigate({ to: search.redirect || "/" });
		},
	});

	const modeContent = authModes[mode];

	const handleModeChange = (value: string | null) => {
		if (value !== "login" && value !== "signup") return;
		setMode(value);
		setSubmitError(null);
	};

	return (
		<Center p="xl" pt={{ base: 40, md: 56 }}>
			<Paper shadow="sm" radius="md" p="xl" maw={600} w="100%">
				<Stack gap="lg">
					<Stack gap="xs">
						<Title order={1} size="h2">
							{modeContent.title}
						</Title>
						<Text c="dimmed" size="sm">
							{modeContent.subtitle}
						</Text>
					</Stack>

					<Tabs value={mode} onChange={handleModeChange}>
						<Tabs.List grow>
							<Tabs.Tab value="login">Login</Tabs.Tab>
							<Tabs.Tab value="signup">Sign Up</Tabs.Tab>
						</Tabs.List>
					</Tabs>

					<form
						onSubmit={(event) => {
							event.preventDefault();
							event.stopPropagation();
							void authForm.handleSubmit();
						}}
					>
						<authForm.AppForm>
							<Stack gap="md">
								<authForm.AppField name="email">
									{(field) => (
										<field.TextField
											type="email"
											label="Email"
											autoComplete="email"
											placeholder="you@example.com"
										/>
									)}
								</authForm.AppField>

								<authForm.AppField name="password">
									{(field) => (
										<>
											<field.TextField
												type="password"
												label="Password"
												placeholder="Enter your password"
												autoComplete={modeContent.passwordAutoComplete}
											/>

											{submitError ? (
												<Text c="red" size="xs">
													{submitError}
												</Text>
											) : null}
										</>
									)}
								</authForm.AppField>
								<authForm.SubmitButton
									className="w-full"
									pendingLabel="Please wait..."
									label={modeContent.actionLabel}
								/>
							</Stack>
						</authForm.AppForm>
					</form>
				</Stack>
			</Paper>
		</Center>
	);
}
```

**Step 2: Verify types**

Run: `bun run typecheck`

Expected: No errors in start.tsx

**Step 3: Commit start page changes**

```bash
git add 'apps/app-frontend/src/routes/start.tsx'
git commit -m 'refactor(app-frontend): migrate start page to Mantine components'
```

---

## Task 7: Update Protected Index Page

**Files:**
- Modify: `apps/app-frontend/src/routes/_protected/index.tsx`

**Step 1: Replace with Mantine components**

Replace the entire content of `apps/app-frontend/src/routes/_protected/index.tsx`:

```typescript
import { Anchor, Box, Button, Container, Flex, Grid, Paper, Stack, Text, Title } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useApiClient } from "#/hooks/api";
import { useAuthClient } from "#/hooks/auth";

export const Route = createFileRoute("/_protected/")({
	component: App,
});

function App() {
	const apiClient = useApiClient();
	const authClient = useAuthClient();
	const { user } = Route.useRouteContext();

	const entitySchemasQuery = apiClient.useQuery("get", "/entity-schemas/list");

	const runMutation = useMutation({
		mutationFn: async () => {
			const response = await authClient.apiKey.create();
			return response.data;
		},
	});

	return (
		<Container size="lg" px="md" pb={32} pt={56}>
			<Paper shadow="md" radius="xl" p={{ base: 24, sm: 40 }} pos="relative" style={{ overflow: "hidden" }}>
				<Button onClick={() => runMutation.mutate()}>Create API Key</Button>
				{runMutation.data?.key && <Text>API Key: {runMutation.data.key}</Text>}
				<pre>{JSON.stringify(entitySchemasQuery.data, null, 2)}</pre>
				{JSON.stringify(user, null, 3)}
				<Box
					pos="absolute"
					left={-80}
					top={-96}
					h={224}
					w={224}
					style={{
						borderRadius: "50%",
						background: "radial-gradient(circle, rgba(79, 184, 178, 0.32), transparent 66%)",
						pointerEvents: "none",
					}}
				/>
				<Box
					pos="absolute"
					bottom={-80}
					right={-80}
					h={224}
					w={224}
					style={{
						borderRadius: "50%",
						background: "radial-gradient(circle, rgba(47, 106, 74, 0.18), transparent 66%)",
						pointerEvents: "none",
					}}
				/>
				<Text c="teal" size="sm" fw={600} mb={12}>
					TanStack Start Base Template
				</Text>
				<Title order={1} size="3rem" lh={1.02} fw={700} maw={768} mb={20}>
					Island hours, but for product teams.
				</Title>
				<Text c="dimmed" size="lg" maw={672} mb={32}>
					A tropical, breathable app starter with full-document SSR, server
					functions, streaming, and type-safe routing. Calm on the eyes. Fast in
					production.
				</Text>
				<Flex gap="md" wrap="wrap">
					<Anchor
						href="/blog"
						px={20}
						py={10}
						style={{
							borderRadius: 9999,
							border: "1px solid rgba(50, 143, 151, 0.3)",
							background: "rgba(79, 184, 178, 0.14)",
							fontSize: "0.875rem",
							fontWeight: 600,
							color: "var(--mantine-color-teal-7)",
							textDecoration: "none",
							transition: "all 0.2s",
						}}
					>
						Explore Posts
					</Anchor>
					<Anchor
						href="https://tanstack.com/router"
						target="_blank"
						rel="noopener noreferrer"
						px={20}
						py={10}
						style={{
							borderRadius: 9999,
							border: "1px solid rgba(23, 58, 64, 0.2)",
							background: "rgba(255, 255, 255, 0.5)",
							fontSize: "0.875rem",
							fontWeight: 600,
							textDecoration: "none",
							transition: "all 0.2s",
						}}
					>
						Router Guide
					</Anchor>
				</Flex>
			</Paper>

			<Grid mt={32} gutter="md">
				{[
					[
						"Type-Safe Routing",
						"Routes and links stay in sync across every page.",
					],
					[
						"Server Functions",
						"Call server code from your UI without creating API boilerplate.",
					],
					[
						"Streaming by Default",
						"Ship progressively rendered responses for faster experiences.",
					],
					[
						"Mantine Components",
						"Build quickly with a comprehensive component library.",
					],
				].map(([title, desc], index) => (
					<Grid.Col key={title} span={{ base: 12, sm: 6, lg: 3 }}>
						<Paper shadow="sm" radius="md" p="lg">
							<Stack gap="xs">
								<Text fw={600}>{title}</Text>
								<Text c="dimmed" size="sm">
									{desc}
								</Text>
							</Stack>
						</Paper>
					</Grid.Col>
				))}
			</Grid>

			<Paper shadow="sm" radius="md" p="xl" mt={32}>
				<Text c="teal" size="sm" fw={600} mb={8}>
					Quick Start
				</Text>
				<Stack gap="sm">
					<Text size="sm" c="dimmed">
						• Edit <code>src/routes/index.tsx</code> to customize the hero and
						product narrative.
					</Text>
					<Text size="sm" c="dimmed">
						• Update <code>src/components/Header.tsx</code> and{" "}
						<code>src/components/Footer.tsx</code> for brand links.
					</Text>
					<Text size="sm" c="dimmed">
						• Add routes in <code>src/routes</code> and tweak visual tokens in{" "}
						<code>src/styles.css</code>.
					</Text>
				</Stack>
			</Paper>
		</Container>
	);
}
```

**Step 2: Verify types**

Run: `bun run typecheck`

Expected: No errors in index.tsx

**Step 3: Commit protected index page changes**

```bash
git add 'apps/app-frontend/src/routes/_protected/index.tsx'
git commit -m 'refactor(app-frontend): migrate protected index page to Mantine components'
```

---

## Task 8: Delete shadcn Component Files

**Files:**
- Delete: `apps/app-frontend/src/components/ui/button.tsx`
- Delete: `apps/app-frontend/src/components/ui/card.tsx`
- Delete: `apps/app-frontend/src/components/ui/input.tsx`
- Delete: `apps/app-frontend/src/components/ui/label.tsx`
- Delete: `apps/app-frontend/src/components/ui/tabs.tsx`
- Delete: `apps/app-frontend/src/components/ui/` (entire directory)

**Step 1: Delete UI components directory**

Run: `rm -rf 'apps/app-frontend/src/components/ui'`

Expected: Directory deleted

**Step 2: Delete components directory if empty**

Run: `rmdir 'apps/app-frontend/src/components' 2>/dev/null || true`

Expected: Directory deleted if empty, no error if not empty

**Step 3: Commit deletion**

```bash
git add -A 'apps/app-frontend/src/components/'
git commit -m 'refactor(app-frontend): remove shadcn UI components'
```

---

## Task 9: Delete Tailwind Utility File

**Files:**
- Delete: `apps/app-frontend/src/lib/utils.ts`

**Step 1: Delete utils.ts**

Run: `rm 'apps/app-frontend/src/lib/utils.ts'`

Expected: File deleted

**Step 2: Commit deletion**

```bash
git add 'apps/app-frontend/src/lib/utils.ts'
git commit -m 'refactor(app-frontend): remove Tailwind cn utility'
```

---

## Task 10: Delete shadcn Config File

**Files:**
- Delete: `apps/app-frontend/components.json`

**Step 1: Delete components.json**

Run: `rm 'apps/app-frontend/components.json'`

Expected: File deleted

**Step 2: Commit deletion**

```bash
git add 'apps/app-frontend/components.json'
git commit -m 'refactor(app-frontend): remove shadcn config file'
```

---

## Task 11: Verify TypeScript Build

**Step 1: Run typecheck**

Run: `bun run turbo typecheck`

Expected: No TypeScript errors in app-frontend

**Step 2: Run build**

Run: `bun run turbo build --filter=@ryot/app-frontend`

Expected: Build succeeds without errors

**Step 3: If successful, create final commit**

```bash
git add -A 'apps/app-frontend/'
git commit -m 'refactor(app-frontend): complete migration from Tailwind/shadcn to Mantine v9'
```

---

## Task 12: Visual Verification (Manual)

**Step 1: Start dev server**

Run: `bun run dev`

Expected: Dev server starts on port 3005

**Step 2: Test start page**

Navigate to: http://localhost:3005/start

Check:
- Login/Signup tabs render correctly
- Form inputs work
- Button styling looks appropriate
- No console errors

**Step 3: Test protected page**

After login, navigate to: http://localhost:3005/

Check:
- Page renders without errors
- Buttons work
- Layout looks reasonable
- No console errors

**Step 4: Test dark mode (if implemented)**

Toggle dark mode in system preferences

Check:
- App switches to dark theme
- All components remain readable

---

## Success Criteria

- ✅ No Tailwind dependencies in package.json
- ✅ No shadcn components in codebase
- ✅ No Tailwind classes in any file
- ✅ TypeScript compiles without errors
- ✅ Build succeeds
- ✅ All pages render without errors
- ✅ Forms are functional

## Rollback

If critical issues arise:

```bash
git revert HEAD~12..HEAD
bun install
```
