use std::sync::Arc;

use anyhow::{Result, anyhow, bail};
use common_models::{
    ChangeCollectionToEntitiesInput, DefaultCollection, EntityAssets, EntityToCollectionInput,
};
use common_utils::ryot_log;
use database_models::{
    exercise,
    prelude::{Exercise, UserToEntity},
    user_to_entity,
};
use dependent_collection_utils::add_entities_to_collection;
use dependent_models::UpdateCustomExerciseInput;
use dependent_utility_utils::expire_user_exercises_list_cache;
use enum_models::{EntityLot, ExerciseLot, ExerciseSource};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, IntoActiveModel, ModelTrait,
    QueryFilter,
};
use supporting_service::SupportingService;

pub fn generate_exercise_id(name: &str, lot: ExerciseLot, user_id: &str) -> String {
    format!("{name}_{lot}_{user_id}")
}

pub async fn create_custom_exercise(
    user_id: &String,
    input: exercise::Model,
    ss: &Arc<SupportingService>,
) -> Result<String> {
    ensure_user_can_use_assets(user_id, &input.assets, None)?;
    let mut input = input;
    input.source = ExerciseSource::Custom;
    input.created_by_user_id = Some(user_id.clone());
    input.id = generate_exercise_id(&input.name, input.lot, user_id);
    let mut input = input.into_active_model();
    input.aggregated_instructions = ActiveValue::NotSet;

    let exercise = input.insert(&ss.db).await?;
    ryot_log!(debug, "Created custom exercise with id = {}", exercise.id);
    add_entities_to_collection(
        &user_id.clone(),
        ChangeCollectionToEntitiesInput {
            creator_user_id: user_id.to_owned(),
            collection_name: DefaultCollection::Custom.to_string(),
            entities: vec![EntityToCollectionInput {
                information: None,
                entity_id: exercise.id.clone(),
                entity_lot: EntityLot::Exercise,
            }],
        },
        ss,
    )
    .await?;
    expire_user_exercises_list_cache(user_id, ss).await?;
    Ok(exercise.id)
}

pub async fn update_custom_exercise(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: UpdateCustomExerciseInput,
) -> Result<bool> {
    let UpdateCustomExerciseInput {
        mut update,
        should_delete,
    } = input;
    let id = update.id.clone();
    let delete_entity = should_delete.unwrap_or_default();
    let old_exercise = Exercise::find_by_id(&id)
        .one(&ss.db)
        .await?
        .ok_or_else(|| anyhow!("Exercise does not exist"))?;
    if old_exercise.source != ExerciseSource::Custom {
        bail!("This exercise is not custom and cannot be updated");
    }
    if old_exercise.created_by_user_id.as_deref() != Some(user_id.as_str()) {
        bail!("You are not authorized to update this exercise");
    }
    ensure_user_can_use_assets(&user_id, &update.assets, Some(&old_exercise.assets))?;
    let (images_to_delete, videos_to_delete) = if delete_entity {
        (
            old_exercise.assets.s3_images.clone(),
            old_exercise.assets.s3_videos.clone(),
        )
    } else {
        old_exercise.assets.removed_s3_objects(&update.assets)
    };
    for image in images_to_delete {
        file_storage_service::delete_object(ss, &user_id, image).await?;
    }
    for video in videos_to_delete {
        file_storage_service::delete_object(ss, &user_id, video).await?;
    }
    if delete_entity {
        let ute = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(&user_id))
            .filter(user_to_entity::Column::ExerciseId.eq(&id))
            .one(&ss.db)
            .await?
            .ok_or_else(|| anyhow!("Exercise does not exist"))?;
        if let Some(exercise_extra_information) = ute.exercise_extra_information
            && !exercise_extra_information.history.is_empty()
        {
            bail!("Exercise is associated with one or more workouts.");
        }
        old_exercise.delete(&ss.db).await?;
        return Ok(true);
    }
    update.source = ExerciseSource::Custom;
    update.created_by_user_id = Some(user_id.clone());
    let input = update.into_active_model();
    let mut input = input.reset_all();
    input.id = ActiveValue::Unchanged(id);
    input.aggregated_instructions = ActiveValue::NotSet;
    input.update(&ss.db).await?;
    expire_user_exercises_list_cache(&user_id, ss).await?;
    Ok(true)
}

fn ensure_user_can_use_assets(
    user_id: &str,
    assets: &EntityAssets,
    existing_assets: Option<&EntityAssets>,
) -> Result<()> {
    for key in assets.s3_images.iter().chain(&assets.s3_videos) {
        let is_existing_asset = existing_assets
            .is_some_and(|assets| assets.s3_images.contains(key) || assets.s3_videos.contains(key));
        file_storage_service::ensure_user_can_use_upload(user_id, key, is_existing_asset)?;
    }
    Ok(())
}
