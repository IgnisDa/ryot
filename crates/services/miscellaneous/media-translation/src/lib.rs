use std::sync::Arc;

use anyhow::{Result, anyhow, bail};
use background_models::{ApplicationJob, MpApplicationJob, UpdateMediaTranslationJobInput};
use chrono::Utc;
use database_models::{
    entity_translation, metadata, metadata_group, person,
    prelude::{EntityTranslation, Metadata, MetadataGroup, Person},
};
use database_utils::user_by_id;
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, EmptyCacheValue, ExpireCacheKeyInput,
    MediaTranslationInProgressCacheInput,
};
use dependent_provider_utils::{get_metadata_provider, get_non_metadata_provider};
use enum_models::{EntityLot, EntityTranslationVariant, MediaSource};
use media_models::{
    MediaTranslationInput, MediaTranslationPending, MediaTranslationPendingStatus,
    MediaTranslationResult, MediaTranslationValue,
};
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter, QuerySelect};
use supporting_service::SupportingService;
use user_models::UserProviderLanguagePreferences;

async fn get_entity_source(
    input: &MediaTranslationInput,
    ss: &Arc<SupportingService>,
) -> Result<MediaSource> {
    macro_rules! fetch_source {
        ($entity:ident, $mod:ident, $name:literal) => {
            $entity::find_by_id(&input.entity_id)
                .select_only()
                .column($mod::Column::Source)
                .into_tuple::<MediaSource>()
                .one(&ss.db)
                .await?
                .ok_or_else(|| anyhow!(concat!($name, " not found")))?
        };
    }

    Ok(match input.entity_lot {
        EntityLot::Person => fetch_source!(Person, person, "Person"),
        EntityLot::Metadata => fetch_source!(Metadata, metadata, "Metadata"),
        EntityLot::MetadataGroup => fetch_source!(MetadataGroup, metadata_group, "Metadata group"),
        _ => bail!("Unsupported entity lot for translations"),
    })
}

async fn get_preferred_language_for_input(
    user_id: &String,
    input: &MediaTranslationInput,
    ss: &Arc<SupportingService>,
) -> Result<String> {
    let source = get_entity_source(input, ss).await?;
    get_preferred_language_for_user_and_source(ss, user_id, &source).await
}

async fn get_preferred_language_for_user_and_source(
    ss: &Arc<SupportingService>,
    user_id: &String,
    source: &MediaSource,
) -> Result<String> {
    let user_preferences = user_by_id(user_id, ss).await?.preferences;
    let Some(UserProviderLanguagePreferences {
        preferred_language, ..
    }) = user_preferences
        .languages
        .providers
        .into_iter()
        .find(|lang| lang.source == *source)
    else {
        bail!("No preferred language found for source {}", source);
    };
    Ok(preferred_language)
}

fn build_in_progress_cache_key(
    entity_id: &str,
    entity_lot: EntityLot,
    variant: EntityTranslationVariant,
    language: &str,
) -> ApplicationCacheKey {
    ApplicationCacheKey::MediaTranslationInProgress(MediaTranslationInProgressCacheInput {
        variant,
        entity_lot,
        language: language.to_string(),
        entity_id: entity_id.to_string(),
    })
}

pub async fn update_media_translation(
    ss: &Arc<SupportingService>,
    input: UpdateMediaTranslationJobInput,
) -> Result<()> {
    let preferred_language = match input.entity_lot {
        EntityLot::Metadata => {
            let entity = Metadata::find_by_id(&input.entity_id)
                .one(&ss.db)
                .await?
                .ok_or_else(|| anyhow!("Metadata not found"))?;
            let preferred_language =
                get_preferred_language_for_user_and_source(ss, &input.user_id, &entity.source)
                    .await?;
            get_metadata_provider(entity.lot, entity.source, ss)
                .await?
                .translate_metadata(&entity.identifier, &preferred_language)
                .await?;
            let mut item: metadata::ActiveModel = entity.into();
            item.last_updated_on = ActiveValue::Set(Utc::now());
            item.update(&ss.db).await?;
            preferred_language
        }
        EntityLot::MetadataGroup => {
            let entity = MetadataGroup::find_by_id(&input.entity_id)
                .one(&ss.db)
                .await?
                .ok_or_else(|| anyhow!("Metadata group not found"))?;
            let preferred_language =
                get_preferred_language_for_user_and_source(ss, &input.user_id, &entity.source)
                    .await?;
            get_metadata_provider(entity.lot, entity.source, ss)
                .await?
                .translate_metadata_group(&entity.identifier, &preferred_language)
                .await?;
            let mut item: metadata_group::ActiveModel = entity.into();
            item.last_updated_on = ActiveValue::Set(Utc::now());
            item.update(&ss.db).await?;
            preferred_language
        }
        EntityLot::Person => {
            let person = Person::find_by_id(&input.entity_id)
                .one(&ss.db)
                .await?
                .ok_or_else(|| anyhow!("Person not found"))?;
            let preferred_language =
                get_preferred_language_for_user_and_source(ss, &input.user_id, &person.source)
                    .await?;
            get_non_metadata_provider(person.source, ss)
                .await?
                .translate_person(
                    &person.identifier,
                    &preferred_language,
                    &person.source_specifics,
                )
                .await?;
            let mut item: person::ActiveModel = person.into();
            item.last_updated_on = ActiveValue::Set(Utc::now());
            item.update(&ss.db).await?;
            preferred_language
        }
        _ => bail!("Unsupported entity lot for translations"),
    };

    cache_service::expire_key(
        ss,
        ExpireCacheKeyInput::ByKey(Box::new(build_in_progress_cache_key(
            &input.entity_id,
            input.entity_lot,
            input.variant,
            &preferred_language,
        ))),
    )
    .await?;
    Ok(())
}

pub async fn deploy_update_media_translations_job(
    user_id: String,
    input: MediaTranslationInput,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    let preferred_language = get_preferred_language_for_input(&user_id, &input, ss).await?;
    let cache_key = build_in_progress_cache_key(
        &input.entity_id,
        input.entity_lot,
        input.variant,
        &preferred_language,
    );
    if cache_service::get_value::<EmptyCacheValue>(ss, cache_key.clone())
        .await
        .is_some()
    {
        return Ok(true);
    }
    cache_service::set_key(
        ss,
        cache_key,
        ApplicationCacheValue::MediaTranslationInProgress(EmptyCacheValue { _empty: () }),
    )
    .await?;

    let job_input = UpdateMediaTranslationJobInput {
        user_id,
        variant: input.variant,
        entity_id: input.entity_id,
        entity_lot: input.entity_lot,
    };
    ss.perform_application_job(ApplicationJob::Mp(
        MpApplicationJob::UpdateMediaTranslations(job_input),
    ))
    .await?;
    Ok(true)
}

pub async fn media_translation(
    user_id: &String,
    input: MediaTranslationInput,
    ss: &Arc<SupportingService>,
) -> Result<MediaTranslationResult> {
    macro_rules! fetch_source {
        ($entity:ident, $mod:ident, $name:literal) => {
            $entity::find_by_id(&input.entity_id)
                .select_only()
                .column($mod::Column::Source)
                .into_tuple::<MediaSource>()
                .one(&ss.db)
                .await?
                .ok_or_else(|| anyhow!(concat!($name, " not found")))?
        };
    }

    let source = match input.entity_lot {
        EntityLot::Person => fetch_source!(Person, person, "Person"),
        EntityLot::Metadata => fetch_source!(Metadata, metadata, "Metadata"),
        EntityLot::MetadataGroup => fetch_source!(MetadataGroup, metadata_group, "Metadata group"),
        _ => bail!("Unsupported entity lot for translations"),
    };
    let preferred_language =
        get_preferred_language_for_user_and_source(ss, user_id, &source).await?;

    if let Some(translation) = EntityTranslation::find()
        .filter(entity_translation::Column::EntityId.eq(&input.entity_id))
        .filter(entity_translation::Column::EntityLot.eq(input.entity_lot))
        .filter(entity_translation::Column::Language.eq(&preferred_language))
        .filter(entity_translation::Column::Variant.eq(input.variant))
        .one(&ss.db)
        .await?
    {
        return Ok(MediaTranslationResult::Value(MediaTranslationValue {
            value: translation.value,
        }));
    }

    let cache_key = build_in_progress_cache_key(
        &input.entity_id,
        input.entity_lot,
        input.variant,
        &preferred_language,
    );
    if cache_service::get_value::<EmptyCacheValue>(ss, cache_key)
        .await
        .is_some()
    {
        return Ok(MediaTranslationResult::Pending(MediaTranslationPending {
            status: MediaTranslationPendingStatus::InProgress,
        }));
    }

    Ok(MediaTranslationResult::Pending(MediaTranslationPending {
        status: MediaTranslationPendingStatus::NotFetched,
    }))
}
