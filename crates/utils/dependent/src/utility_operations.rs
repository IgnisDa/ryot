use async_graphql::Result;
use chrono::Utc;
use common_models::{MetadataRecentlyConsumedCacheInput, UserLevelCacheKey};
use database_models::{
    functions::get_user_to_entity_association,
    prelude::{Collection, Metadata, MetadataGroup, Person, Workout, WorkoutTemplate},
    user_to_entity,
};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheKeyDiscriminants, ApplicationCacheValue, EmptyCacheValue,
    ExpireCacheKeyInput,
};
use enum_models::EntityLot;
use sea_orm::{ActiveModelTrait, ActiveValue, EntityTrait};
use std::sync::Arc;
use supporting_service::SupportingService;

pub async fn get_entity_title_from_id_and_lot(
    id: &String,
    lot: EntityLot,
    ss: &Arc<SupportingService>,
) -> Result<String> {
    let obj_title = match lot {
        EntityLot::Metadata => Metadata::find_by_id(id).one(&ss.db).await?.unwrap().title,
        EntityLot::MetadataGroup => {
            MetadataGroup::find_by_id(id)
                .one(&ss.db)
                .await?
                .unwrap()
                .title
        }
        EntityLot::Person => Person::find_by_id(id).one(&ss.db).await?.unwrap().name,
        EntityLot::Collection => Collection::find_by_id(id).one(&ss.db).await?.unwrap().name,
        EntityLot::Exercise => id.clone(),
        EntityLot::Workout => Workout::find_by_id(id).one(&ss.db).await?.unwrap().name,
        EntityLot::WorkoutTemplate => {
            WorkoutTemplate::find_by_id(id)
                .one(&ss.db)
                .await?
                .unwrap()
                .name
        }
        EntityLot::Review | EntityLot::UserMeasurement => {
            unreachable!()
        }
    };
    Ok(obj_title)
}

pub async fn mark_entity_as_recently_consumed(
    user_id: &String,
    entity_id: &String,
    entity_lot: EntityLot,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    ss.cache_service
        .set_key(
            ApplicationCacheKey::MetadataRecentlyConsumed(UserLevelCacheKey {
                user_id: user_id.to_owned(),
                input: MetadataRecentlyConsumedCacheInput {
                    entity_lot,
                    entity_id: entity_id.to_owned(),
                },
            }),
            ApplicationCacheValue::MetadataRecentlyConsumed(EmptyCacheValue::default()),
        )
        .await?;
    Ok(())
}

pub async fn associate_user_with_entity(
    user_id: &String,
    entity_id: &String,
    entity_lot: EntityLot,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let user_to_entity_model =
        get_user_to_entity_association(&ss.db, user_id, entity_id, entity_lot).await?;

    let entity_id_owned = entity_id.to_owned();

    match user_to_entity_model {
        Some(u) => {
            let mut to_update: user_to_entity::ActiveModel = u.into();
            to_update.last_updated_on = ActiveValue::Set(Utc::now());
            to_update.needs_to_be_updated = ActiveValue::Set(Some(true));
            to_update.update(&ss.db).await.unwrap();
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
                    new_user_to_entity.metadata_group_id = ActiveValue::Set(Some(entity_id_owned))
                }
                EntityLot::Collection
                | EntityLot::Workout
                | EntityLot::WorkoutTemplate
                | EntityLot::Review
                | EntityLot::UserMeasurement => {
                    unreachable!()
                }
            }
            new_user_to_entity.insert(&ss.db).await.unwrap();
        }
    };
    expire_user_metadata_list_cache(user_id, ss).await?;
    Ok(())
}

pub async fn get_entity_recently_consumed(
    user_id: &String,
    entity_id: &String,
    entity_lot: EntityLot,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    Ok(ss
        .cache_service
        .get_value::<EmptyCacheValue>(ApplicationCacheKey::MetadataRecentlyConsumed(
            UserLevelCacheKey {
                user_id: user_id.to_owned(),
                input: MetadataRecentlyConsumedCacheInput {
                    entity_lot,
                    entity_id: entity_id.to_owned(),
                },
            },
        ))
        .await
        .is_some())
}

pub async fn expire_user_collections_list_cache(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let cache_key = ApplicationCacheKey::UserCollectionsList(UserLevelCacheKey {
        input: (),
        user_id: user_id.to_owned(),
    });
    ss.cache_service
        .expire_key(ExpireCacheKeyInput::ByKey(cache_key))
        .await?;
    Ok(())
}

pub async fn expire_user_workouts_list_cache(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    ss.cache_service
        .expire_key(ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(user_id.to_owned()),
            key: ApplicationCacheKeyDiscriminants::UserWorkoutsList,
        })
        .await?;
    Ok(())
}

pub async fn expire_user_measurements_list_cache(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    ss.cache_service
        .expire_key(ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(user_id.to_owned()),
            key: ApplicationCacheKeyDiscriminants::UserMeasurementsList,
        })
        .await?;
    Ok(())
}

pub async fn expire_user_workout_templates_list_cache(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    ss.cache_service
        .expire_key(ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(user_id.to_owned()),
            key: ApplicationCacheKeyDiscriminants::UserWorkoutTemplatesList,
        })
        .await?;
    Ok(())
}

pub async fn expire_user_metadata_list_cache(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    ss.cache_service
        .expire_key(ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(user_id.to_owned()),
            key: ApplicationCacheKeyDiscriminants::UserMetadataList,
        })
        .await?;
    Ok(())
}
