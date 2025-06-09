use async_graphql::Result;
use background_models::{ApplicationJob, MpApplicationJob};
use common_utils::ryot_log;
use database_models::{prelude::Exercise, user};
use database_utils::get_user_query;

use sea_orm::{ActiveModelTrait, ActiveValue, EntityTrait, PaginatorTrait, QueryFilter};
use sea_query::Expr;
use std::sync::Arc;
use supporting_service::SupportingService;

use crate::exercise_management;

pub async fn deploy_update_exercise_library_job(ss: &Arc<SupportingService>) -> Result<()> {
    if Exercise::find().count(&ss.db).await? > 0 {
        return Ok(());
    }
    ryot_log!(
        info,
        "Instance does not have exercises data. Deploying job to download them..."
    );
    ss.perform_application_job(ApplicationJob::Mp(MpApplicationJob::UpdateGithubExercises))
        .await?;
    Ok(())
}

pub async fn update_github_exercises(ss: &Arc<SupportingService>) -> Result<()> {
    let exercises = exercise_management::get_all_exercises_from_dataset(ss).await?;
    for exercise in exercises {
        exercise_management::update_github_exercise(ss, exercise).await?;
    }
    Ok(())
}

pub async fn process_users_scheduled_for_workout_revision(
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let revisions = get_user_query()
        .filter(Expr::cust(
            "(extra_information -> 'scheduled_for_workout_revision')::boolean = true",
        ))
        .all(&ss.db)
        .await?;
    if revisions.is_empty() {
        return Ok(());
    }
    for user in revisions {
        ryot_log!(debug, "Revising workouts for {}", user.id);
        crate::workout_operations::revise_user_workouts(ss, user.id.clone()).await?;
        let mut extra_information = user.extra_information.clone().unwrap_or_default();
        extra_information.scheduled_for_workout_revision = false;
        let mut user: user::ActiveModel = user.into();
        user.extra_information = ActiveValue::Set(Some(extra_information));
        user.update(&ss.db).await?;
    }
    ryot_log!(debug, "Completed scheduled workout revisions");
    Ok(())
}
