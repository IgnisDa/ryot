# Kernel Client

The React DOM kernel. On the web it runs in the browser; on iOS and Android the same build runs
inside a Capacitor host. This document covers native packaging and branding. Application
architecture lives in `docs/ryot-client-plugin-design.md`.

## Build Variants

Capacitor has no variant system, so identity is owned by each platform's build configuration
rather than by `capacitor.config.ts`. That file records the production identity only; it is
informational at runtime and must not be made environment-dependent.

|            | Debug             | Release       |
| ---------- | ----------------- | ------------- |
| Name       | Ryot Debug        | Ryot          |
| Identifier | `io.ryot.app.dev` | `io.ryot.app` |
| Icon       | Blue `#4dabf7`    | Orange        |

- **iOS** — `Info.plist` reads `$(APP_DISPLAY_NAME)` and `$(PRODUCT_BUNDLE_IDENTIFIER)`; both are
  set per configuration in the Xcode target's build settings.
- **Android** — the `debug` build type applies `applicationIdSuffix ".dev"`, and
  `app/src/debug/res/values/` overrides the display strings and the launcher background from
  `app/src/main`.

Both variants install side by side, which is what the retired Expo client got from `APP_VARIANT`.
`bun run ios` and `bun run android` build Debug, so they produce the dev variant.

The debug icon puts the mark on the complement of the brand orange so the two are distinguishable
in a launcher. On Android it only reaches the adaptive icon, so API 24 and 25 fall back to the
production launcher bitmaps; that is accepted rather than carrying a second set of debug mipmaps.

## Branding Assets

The sources in `assets/` drive every platform icon and splash screen:

| Source          | Drives                                                           |
| --------------- | ---------------------------------------------------------------- |
| `icon-only.png` | iOS app icon, Android legacy and round launcher icons, web icons |
| `logo.png`      | Android adaptive-icon foreground, iOS and Android splash screens |
| `dev/logo.png`  | iOS debug app icon                                               |

`dev/` links back to `logo.png`; it exists only so a generation pass can see the mark without
`icon-only.png`. `logo.png` must stay RGBA: `capacitor-assets` composites the icon background in
the source image's colour space, so a greyscale source silently renders the background from its
red channel alone.

`bun run generate-assets` regenerates everything from those sources. It runs
`scripts/generate-assets.ts`, which owns every `capacitor-assets` invocation and the fixups each
one needs; the package script is only an entry point. Never hand-edit the emitted `mipmap-*`,
`drawable-*`, or `Assets.xcassets` output.

The splash logo is sized per platform because `capacitor-assets` scales the iOS splash logo
relative to the source image but the Android one relative to the target canvas. The values chosen
render the mark at roughly the 100pt the Expo client used.

The iOS debug icon is generated first, because `icon-only.png` bakes the orange into its pixels
and no background colour can move that icon off brand. That pass reads `assets/dev`, where the
transparent mark is the only source and the colour does apply, and it writes the production icon
set, so the script claims the result into `AppIconDev.appiconset` before the production pass
restores `AppIcon.appiconset`. The Xcode target picks between the two with a per-configuration
`ASSETCATALOG_COMPILER_APPICON_NAME`.

After the Android pass the script rewrites the two `mipmap-anydpi-v26` layer lists to reference
`@color/ic_launcher_background` and deletes the emitted background bitmaps. `capacitor-assets`
insets both adaptive-icon layers into the 72dp safe zone and emits a solid-colour background
bitmap per density; an adaptive background must be full-bleed or launcher parallax reveals
transparent edges. Referencing the colour is also what lets the debug resource overlay give the
debug variant its own launcher icon, so Android needs no generated debug artwork at all.

The run ends with the web icons. `capacitor-assets` writes only into the native projects, and its
`--pwa` mode emits a whole Apple splash set under names of its own, so `public/favicon.png` and
`public/apple-touch-icon.png` are resized from `icon-only.png` with `sharp` instead. `index.html`
links both by name, and generating them here is what keeps them from drifting off the native icons.

## Deep Links

Both platforms register only the variant's bundle identifier. Debug uses `io.ryot.app.dev` and
release uses `io.ryot.app`. On Android the identifier scheme comes from the `${applicationId}`
manifest placeholder, and on iOS from `$(PRODUCT_BUNDLE_IDENTIFIER)`, so neither needs a
per-variant literal.

`resolveDeepLinkHref` maps an incoming URL onto a kernel route. A custom-scheme URL puts its first
path segment in the authority, so `io.ryot.app://settings/account` has to be folded back into
`/settings/account`; `http` and `https` links use their path unchanged. Anything else is ignored.

`startNativeNavigation` is a no-op off native. On native it navigates on `appUrlOpen`, replaces the
current entry for a launch URL, and maps the Android hardware back button onto the router's
history, exiting the app only when there is nothing left to pop. The kernel remains the sole owner
of history, per the single-navigation-stack rule in the design document.

## Commands

```sh
bun run dev              # web dev server on :3005
bun run generate-assets  # regenerate native icons and splash screens from assets/
bun run sync             # build the web bundle and copy it into both native projects
bun run ios              # sync, then build and run the Debug variant
bun run android          # sync, then build and run the Debug variant
```
