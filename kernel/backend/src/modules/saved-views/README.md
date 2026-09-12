# Saved views

`definition_saved_view` owns built-in content. `saved_view` holds only custom user views, and
`saved_view_override` holds a user's disabled state and order for a built-in. The
`user_saved_view_effective` view combines these sources for navigation, page preparation,
plugin home selection, RyotQL, and backups. Changing a definition does not copy it into
each account. Overrides follow the same plugin identity and slug through revisions; an
unavailable definition does not appear in the effective view.

Slugs identify views within a user account. Installing or upgrading a system plugin fails
when one of its built-in slugs belongs to any existing custom view, including a disabled
view. Custom creation likewise cannot claim an active built-in slug. Plugin-owned built-ins
require the user's installation to be listed; page preparation still requires a ready client
renderer. A plugin home selection stores the view slug and falls back to the manifest's
built-in home only when its effective view is usable.
