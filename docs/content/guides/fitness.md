# Fitness

!!! danger "Experimental"

    Fitness tracking with Ryot is experimental at best. I will do my best to not
    make incompatible breaking changes, and if I do, I will add a migration path
    in the release notes. If you use fitness features, please make sure you
    always read migration notes before upgrading to prevent loss of data.

Some pointers on Ryot and fitness tracking.

## Exercises

Before you can get exercises tracking working, you will need to import all
exercises data. Follow these steps to do so:

1. Open your instance's `/graphql` endpoint. For example `https://ryot.up.railway.app/graphql`.

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
