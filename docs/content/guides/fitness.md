# Fitness

Some pointers on Ryot and fitness tracking.

## Exercises

Before you can get exercises tracking working, you will need to import all
exercises data. Follow these steps to do so:

1. Open your instance's `/graphql` endpoint. For example `https://ryot.fly.dev/graphql`.

2. Enter the following mutation in the editor and run it.
  ```graphql
  mutation DeployUpdateExerciseLibraryJob {
    deployUpdateExerciseLibraryJob
  }
  ```

The response will include the number of exercises that will be imported. The
import will be done in background, and you can check the progress in the logs.

!!! warning

    This needs to be run only once per instance.
