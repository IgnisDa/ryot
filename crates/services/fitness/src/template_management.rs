use std::sync::Arc;

use anyhow::{Result, bail};
use database_models::{prelude::WorkoutTemplate, workout_template};
use database_utils::server_key_validation_guard;
use dependent_core_utils::is_server_key_validated;
use dependent_fitness_utils::upsert_workout_template;
use dependent_utility_utils::expire_user_workout_templates_list_cache;
use fitness_models::UserWorkoutInput;
use sea_orm::{ColumnTrait, EntityTrait, ModelTrait, QueryFilter};
use supporting_service::SupportingService;

pub async fn create_or_update_user_workout_template(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: UserWorkoutInput,
) -> Result<String> {
    server_key_validation_guard(is_server_key_validated(ss).await?).await?;
    upsert_workout_template(&user_id, input, ss).await
}

pub async fn delete_user_workout_template(
    ss: &Arc<SupportingService>,
    user_id: String,
    workout_template_id: String,
) -> Result<bool> {
    server_key_validation_guard(is_server_key_validated(ss).await?).await?;
    let Some(wkt) = WorkoutTemplate::find_by_id(workout_template_id)
        .filter(workout_template::Column::UserId.eq(&user_id))
        .one(&ss.db)
        .await?
    else {
        bail!("Workout template does not exist for user");
    };
    wkt.delete(&ss.db).await?;
    expire_user_workout_templates_list_cache(&user_id, ss).await?;
    Ok(true)
}
