use std::sync::Arc;

use anyhow::Result;
use chrono::Utc;
use common_models::{EntityWithLot, UserLevelCacheKey};
use database_models::{functions::get_user_to_entity_association, user_to_entity};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheKeyDiscriminants, ApplicationCacheValue, EmptyCacheValue,
    ExpireCacheKeyInput,
};
use enum_models::EntityLot;
use futures::try_join;
use sea_orm::{ActiveModelTrait, ActiveValue, IntoActiveModel};
use supporting_service::SupportingService;

async fn mark_entity_as_recently_consumed(
    user_id: &String,
    entity_id: &String,
    entity_lot: EntityLot,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    cache_service::set_key(
        ss,
        ApplicationCacheKey::EntityRecentlyConsumed(UserLevelCacheKey {
            user_id: user_id.to_owned(),
            input: EntityWithLot {
                entity_lot,
                entity_id: entity_id.to_owned(),
            },
        }),
        ApplicationCacheValue::EntityRecentlyConsumed(EmptyCacheValue::default()),
    )
    .await?;
    Ok(())
}

pub async fn expire_entity_details_cache(
    user_id: &String,
    entity_id: &String,
    entity_lot: EntityLot,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    try_join!(
        expire_user_metadata_list_cache(user_id, ss),
        expire_user_exercises_list_cache(user_id, ss),
        expire_user_workout_details_cache(user_id, entity_id, ss),
        expire_user_metadata_details_cache(user_id, entity_id, ss),
        expire_user_workout_template_details_cache(user_id, entity_id, ss),
        mark_entity_as_recently_consumed(user_id, entity_id, entity_lot, ss),
        cache_service::expire_key(
            ss,
            ExpireCacheKeyInput::ByKey(Box::new(ApplicationCacheKey::UserPersonDetails(
                UserLevelCacheKey {
                    user_id: user_id.to_owned(),
                    input: entity_id.to_owned(),
                }
            )))
        ),
        cache_service::expire_key(
            ss,
            ExpireCacheKeyInput::ByKey(Box::new(ApplicationCacheKey::UserMetadataGroupDetails(
                UserLevelCacheKey {
                    user_id: user_id.to_owned(),
                    input: entity_id.to_owned(),
                }
            )))
        )
    )?;
    Ok(())
}

pub async fn associate_user_with_entity(
    user_id: &String,
    entity_id: &String,
    entity_lot: EntityLot,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    if !matches!(
        entity_lot,
        EntityLot::Workout
            | EntityLot::Review
            | EntityLot::WorkoutTemplate
            | EntityLot::UserMeasurement
    ) {
        let user_to_entity_model =
            get_user_to_entity_association(&ss.db, user_id, entity_id, entity_lot).await?;

        let entity_id_owned = entity_id.to_owned();

        match user_to_entity_model {
            Some(u) => {
                let mut to_update = u.into_active_model();
                to_update.last_updated_on = ActiveValue::Set(Utc::now());
                to_update.needs_to_be_updated = ActiveValue::Set(Some(true));
                to_update.update(&ss.db).await?;
            }
            None => {
                let mut new_user_to_entity = user_to_entity::ActiveModel {
                    user_id: ActiveValue::Set(user_id.to_owned()),
                    last_updated_on: ActiveValue::Set(Utc::now()),
                    needs_to_be_updated: ActiveValue::Set(Some(true)),
                    ..Default::default()
                };

                match entity_lot {
                    EntityLot::Metadata => {
                        new_user_to_entity.metadata_id = ActiveValue::Set(Some(entity_id_owned))
                    }
                    EntityLot::Person => {
                        new_user_to_entity.person_id = ActiveValue::Set(Some(entity_id_owned))
                    }
                    EntityLot::Exercise => {
                        new_user_to_entity.exercise_id = ActiveValue::Set(Some(entity_id_owned))
                    }
                    EntityLot::MetadataGroup => {
                        new_user_to_entity.metadata_group_id =
                            ActiveValue::Set(Some(entity_id_owned))
                    }
                    EntityLot::Genre
                    | EntityLot::Review
                    | EntityLot::Workout
                    | EntityLot::Collection
                    | EntityLot::WorkoutTemplate
                    | EntityLot::UserMeasurement => {
                        unreachable!()
                    }
                }
                new_user_to_entity.insert(&ss.db).await?;
            }
        };
    }
    expire_entity_details_cache(user_id, entity_id, entity_lot, ss).await
}

pub async fn expire_user_collections_list_cache(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let cache_key = ApplicationCacheKey::UserCollectionsList(UserLevelCacheKey {
        input: (),
        user_id: user_id.to_owned(),
    });
    cache_service::expire_key(ss, ExpireCacheKeyInput::ByKey(Box::new(cache_key))).await
}

pub async fn expire_user_metadata_details_cache(
    user_id: &String,
    metadata_id: &str,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    cache_service::expire_key(
        ss,
        ExpireCacheKeyInput::ByKey(Box::new(ApplicationCacheKey::UserMetadataDetails(
            UserLevelCacheKey {
                user_id: user_id.to_owned(),
                input: metadata_id.to_owned(),
            },
        ))),
    )
    .await
}

pub async fn expire_user_collection_contents_cache(
    user_id: &String,
    _collection_id: &str,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    cache_service::expire_key(
        ss,
        ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(user_id.to_owned()),
            key: ApplicationCacheKeyDiscriminants::UserCollectionContents,
        },
    )
    .await
}

pub async fn expire_user_filter_presets_cache(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    cache_service::expire_key(
        ss,
        ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(user_id.to_owned()),
            key: ApplicationCacheKeyDiscriminants::UserFilterPresets,
        },
    )
    .await
}

pub async fn expire_user_workouts_list_cache(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    cache_service::expire_key(
        ss,
        ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(user_id.to_owned()),
            key: ApplicationCacheKeyDiscriminants::UserWorkoutsList,
        },
    )
    .await
}

pub async fn expire_user_measurements_list_cache(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    cache_service::expire_key(
        ss,
        ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(user_id.to_owned()),
            key: ApplicationCacheKeyDiscriminants::UserMeasurementsList,
        },
    )
    .await
}

pub async fn expire_user_workout_templates_list_cache(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    cache_service::expire_key(
        ss,
        ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(user_id.to_owned()),
            key: ApplicationCacheKeyDiscriminants::UserWorkoutTemplatesList,
        },
    )
    .await
}

pub async fn expire_user_exercises_list_cache(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    cache_service::expire_key(
        ss,
        ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(user_id.to_owned()),
            key: ApplicationCacheKeyDiscriminants::UserExercisesList,
        },
    )
    .await
}

pub async fn expire_user_metadata_groups_list_cache(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    cache_service::expire_key(
        ss,
        ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(user_id.to_owned()),
            key: ApplicationCacheKeyDiscriminants::UserMetadataGroupsList,
        },
    )
    .await
}

pub async fn expire_user_people_list_cache(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    cache_service::expire_key(
        ss,
        ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(user_id.to_owned()),
            key: ApplicationCacheKeyDiscriminants::UserPeopleList,
        },
    )
    .await
}

pub async fn expire_user_metadata_list_cache(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    cache_service::expire_key(
        ss,
        ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(user_id.to_owned()),
            key: ApplicationCacheKeyDiscriminants::UserMetadataList,
        },
    )
    .await
}

pub async fn expire_person_details_cache(
    person_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    cache_service::expire_key(
        ss,
        ExpireCacheKeyInput::ByKey(Box::new(ApplicationCacheKey::PersonDetails(
            person_id.to_owned(),
        ))),
    )
    .await
}

pub async fn expire_metadata_group_details_cache(
    metadata_group_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    cache_service::expire_key(
        ss,
        ExpireCacheKeyInput::ByKey(Box::new(ApplicationCacheKey::MetadataGroupDetails(
            metadata_group_id.to_owned(),
        ))),
    )
    .await
}

pub async fn expire_metadata_details_cache(
    metadata_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    cache_service::expire_key(
        ss,
        ExpireCacheKeyInput::ByKey(Box::new(ApplicationCacheKey::MetadataDetails(
            metadata_id.to_owned(),
        ))),
    )
    .await
}

pub async fn expire_user_workout_template_details_cache(
    user_id: &String,
    workout_template_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    cache_service::expire_key(
        ss,
        ExpireCacheKeyInput::ByKey(Box::new(ApplicationCacheKey::UserWorkoutTemplateDetails(
            UserLevelCacheKey {
                user_id: user_id.to_owned(),
                input: workout_template_id.to_owned(),
            },
        ))),
    )
    .await
}

pub async fn expire_user_workout_details_cache(
    user_id: &String,
    workout_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    cache_service::expire_key(
        ss,
        ExpireCacheKeyInput::ByKey(Box::new(ApplicationCacheKey::UserWorkoutDetails(
            UserLevelCacheKey {
                user_id: user_id.to_owned(),
                input: workout_id.to_owned(),
            },
        ))),
    )
    .await
}
