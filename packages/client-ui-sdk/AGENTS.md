# Client UI SDK

- Ship no CSS of its own beyond `theme.css`'s design tokens; components style themselves with Tailwind classes only.
- Keep source scannable by Tailwind: the client plugin compiler treats this package's `.ts`/`.tsx` files as an extra scan source when generating a plugin's stylesheet.
