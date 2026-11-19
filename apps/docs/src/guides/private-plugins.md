# Private plugins

A private plugin adds your own apps, data types and views to Ryot. Only your account can see and use
a plugin you install. Plugins come as a `.zip` archive built with the Ryot CLI.

## Before you install

A plugin is code that runs on Ryot with your account's access. Install a plugin only
when you trust whoever made it:

- It can read all of your data in Ryot.
- It can change and delete your data.
- It can contact any server on the internet.
- Ryot does not verify who published a plugin. Checking the archive is your responsibility.

## Install a plugin

1. Open **Settings → Plugins** and choose **Install plugin**.
2. Choose the plugin's `.zip` archive. Ryot checks it before anything is installed and shows its
   name, version, package ID, description and the actions it can perform.
3. Read the warnings, confirm that you trust the publisher and choose **Continue**.
4. Fill in the plugin's settings, if it has any, and choose **Install plugin**.

The plugin finishes setting up in the background. Choose **Refresh** to see when it is ready.

## Change, update or remove a plugin

Open the plugin in **Settings → Plugins** to manage it:

- **Configuration** changes the plugin's settings. Leave a secret blank to keep its current value.
- **Update package** installs a newer archive of the same plugin. Ryot shows the same review and
  warnings first, and keeps your data and settings.
- **Uninstall** removes the plugin. Ryot refuses while your library, saved views, workflows or
  integrations still use it, so nothing is deleted by accident.
