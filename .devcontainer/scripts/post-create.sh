#!/usr/bin/env bash

# setup the git identities
git config --global user.name "${GIT_AUTHOR_NAME}"
git config --global user.email "${GIT_AUTHOR_EMAIL}"

# These are available only in a fish environment
fish -c '
# setup dependencies
moon sync projects
'
