# Backups and Restore

Ryot backups are portable copies of your personal data. You can keep a backup for safety or
restore it to a new Ryot account later.

## What a backup includes

A backup includes your:

- Profile preferences.
- Media, fitness, measurement, and collection data.
- History, reviews, workouts, and other activity.
- Custom views and notification preferences.
- Uploaded images, videos, and other files managed by Ryot.

Ryot also includes the information needed to identify catalog items without contacting their
providers during a restore.

## What a backup does not include

A backup does not include:

- Passwords, sign-in sessions, connected accounts, or API keys.
- Integrations or notification destinations.
- Server settings and background task history.
- Files linked from other websites.

Secret fields declared by a plugin are removed from the backup.

## Creating a backup

Open _Settings_ → _Backups_ and choose _Create a backup_. Your server packs the backup in the
background, so you can leave the page or close Ryot while it runs. The backup appears in the list
on that page with its progress, and becomes downloadable once it finishes.

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

The same required plugins and providers must be available on the destination Ryot server. You
do not need to configure integrations again until after the restore.

To restore, open _Settings_ → _Backups_ on the destination account, choose _Restore from a
backup_, and upload the `.zip` archive. Ryot checks the archive before it writes anything, so a
damaged or incomplete file is rejected without changing your account. The restore then runs on
your server, and its progress appears in the same list as your backups.

Restore is separate from importing. Do not upload a Ryot backup through the Imports page.

After a successful restore, the account is no longer clean, so the same or another backup cannot
be restored again without resetting the account first.

## Whole-server backups

Portable backups protect user data, but they do not replace a full backup of a self-hosted Ryot
server. Before an upgrade or server move, back up the database and permanent file storage used by
your installation.

Use the backup tools provided by your hosting platform. If you use local file storage, include
its persistent volume. If you use S3-compatible storage, follow your storage provider's backup
guidance.
