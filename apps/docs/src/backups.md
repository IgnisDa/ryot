# Backups and Restore

Ryot backups are portable copies of your personal data. You can keep a backup for safety or
restore it to a new Ryot account later.

## What a backup includes

A backup includes your:

- Profile preferences.
- Media, fitness, measurement, and collection data.
- History, reviews, workouts, and other activity.
- Custom views and notification preferences.
- Integrations and their non-secret settings.
- Uploaded images, videos, and other files managed by Ryot.

Ryot also includes the information needed to identify catalog items without contacting their
providers during a restore.

## What a backup does not include

A backup does not include:

- Passwords, sign-in sessions, connected accounts, or API keys.
- Integration credentials or notification destination secrets.
- Server settings and background task history.
- Files linked from other websites.

Secret fields declared by a plugin are removed from the backup.

## Creating a backup

Open _Settings_ → _Backups_ and choose _Create a backup_. Your server packs the backup in the
background, so you can leave the page or close Ryot while it runs. The backup appears in the list
on that page with its progress, and becomes downloadable once it finishes.

Only one backup operation can be pending or running for an account. This applies to both exports
and restores. Starting another operation before the current one reaches a terminal state is
rejected; wait for the existing run to finish or fail.

Choose _Download_ on a finished backup to save the `.zip` archive. On a phone or tablet, Ryot
hands the archive to the system share sheet so you can save it wherever you keep your files.

You can also delete a backup from this page. Deleting removes the record and the stored archive;
it never touches the data in your account.

## Keeping backups safe

Backup downloads expire after 24 hours. Download the file before it expires and store it in a
safe place. A backup can contain private history and copies of files you uploaded to Ryot.

## Restoring a backup

A backup can only be restored to a clean account. A clean account is new or has been reset and
contains no personal data or custom settings.

The archive records the exact version and source hash for each required system plugin. Every system
requirement must match the destination server. Private plugins owned by the account are included as
canonical manifests and complete source packages. Ryot validates and compiles them before restore.

Plugin configuration and integration setting fields marked as secrets in the manifest are omitted.
The archive records which secret fields were configured, but never their values. A restored plugin
that lacks a required secret stays inactive with `needs-configuration` health; an integration missing
a required secret is restored disabled. Plugin source is user-authored data and can contain embedded
credentials; Ryot cannot reliably redact secrets written directly in source files.

To restore, open _Settings_ → _Backups_ on the destination account, choose _Restore from a
backup_, and upload the `.zip` archive. Ryot checks the archive before it writes anything, so a
damaged or incomplete file is rejected without changing your account. The restore then runs on
your server, and its progress appears in the same list as your backups.

Restore is separate from importing. Do not upload a Ryot backup through the Imports page.

## Archive compatibility

The backup is a versioned Ryot archive, not an arbitrary ZIP file. The current portable format is
`ryot-backup` version 2. Ryot validates its manifest, section checksums, paths, record counts, and
asset checksums, and rejects an unsupported format or version. Restore compatibility therefore
requires a valid version-2 archive and the exact system plugin requirements declared in its manifest.

After a successful restore, the account is no longer clean, so the same or another backup cannot
be restored again without resetting the account first.

## Whole-server backups

Portable backups protect user data, but they do not replace a full backup of a self-hosted Ryot
server. Before an upgrade or server move, back up the database and permanent file storage used by
your installation.

Use the backup tools provided by your hosting platform. If you use local file storage, include
its persistent volume. If you use S3-compatible storage, follow your storage provider's backup
guidance.
