# Documentation Assembly

- Run `bun run generate` from `apps/docs` after changing kernel configuration or a shipped plugin manifest, and commit the generated configuration reference.
- Build the fitness and media plugin bundles before generation so the script reads the artifacts shipped by the image.
