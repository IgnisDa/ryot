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
    EntityTranslationDetails, MediaTranslationInput, MediaTranslationPending,
    MediaTranslationPendingStatus, MediaTranslationResult, MediaTranslationValue,
    PodcastTranslationExtraInformation, ShowTranslationExtraInformation,
};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter, QuerySelect, Select,
};
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

fn translation_value_for_variant(
    variant: EntityTranslationVariant,
    details: &EntityTranslationDetails,
) -> Option<String> {
    match variant {
        EntityTranslationVariant::Title => details.title.clone(),
        EntityTranslationVariant::Image => details.image.clone(),
        EntityTranslationVariant::Description => details.description.clone(),
    }
}

fn build_in_progress_cache_key(
    entity_id: &str,
    entity_lot: EntityLot,
    variant: EntityTranslationVariant,
    language: &str,
    show_extra_information: Option<ShowTranslationExtraInformation>,
    podcast_extra_information: Option<PodcastTranslationExtraInformation>,
) -> ApplicationCacheKey {
    ApplicationCacheKey::MediaTranslationInProgress(MediaTranslationInProgressCacheInput {
        variant,
        entity_lot,
        show_extra_information,
        podcast_extra_information,
        language: language.to_string(),
        entity_id: entity_id.to_string(),
    })
}

fn apply_extra_information_filters(
    query: Select<entity_translation::Entity>,
    show_extra_information: &Option<ShowTranslationExtraInformation>,
    podcast_extra_information: &Option<PodcastTranslationExtraInformation>,
) -> Select<entity_translation::Entity> {
    let query = match show_extra_information {
        Some(info) => {
            query.filter(entity_translation::Column::ShowExtraInformation.eq(info.clone()))
        }
        None => query.filter(entity_translation::Column::ShowExtraInformation.is_null()),
    };
    match podcast_extra_information {
        Some(info) => {
            query.filter(entity_translation::Column::PodcastExtraInformation.eq(info.clone()))
        }
        None => query.filter(entity_translation::Column::PodcastExtraInformation.is_null()),
    }
}

async fn upsert_entity_translation(
    input: &UpdateMediaTranslationJobInput,
    preferred_language: &str,
    value: Option<String>,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let value = value.filter(|v| !v.is_empty());

    let query = EntityTranslation::find()
        .filter(entity_translation::Column::EntityId.eq(&input.entity_id))
        .filter(entity_translation::Column::EntityLot.eq(input.entity_lot))
        .filter(entity_translation::Column::Language.eq(preferred_language))
        .filter(entity_translation::Column::Variant.eq(input.variant));
    let query = apply_extra_information_filters(
        query,
        &input.show_extra_information,
        &input.podcast_extra_information,
    );

    if let Some(existing) = query.one(&ss.db).await? {
        let mut model: entity_translation::ActiveModel = existing.into();
        model.value = ActiveValue::Set(value);
        model.update(&ss.db).await?;
        return Ok(());
    }

    let mut model = entity_translation::ActiveModel {
        value: ActiveValue::Set(value),
        variant: ActiveValue::Set(input.variant),
        language: ActiveValue::Set(preferred_language.to_string()),
        show_extra_information: ActiveValue::Set(input.show_extra_information.clone()),
        podcast_extra_information: ActiveValue::Set(input.podcast_extra_information.clone()),
        ..Default::default()
    };
    match input.entity_lot {
        EntityLot::Person => model.person_id = ActiveValue::Set(Some(input.entity_id.clone())),
        EntityLot::Metadata => model.metadata_id = ActiveValue::Set(Some(input.entity_id.clone())),
        EntityLot::MetadataGroup => {
            model.metadata_group_id = ActiveValue::Set(Some(input.entity_id.clone()))
        }
        _ => {}
    }
    let result = EntityTranslation::insert(model)
        .exec_without_returning(&ss.db)
        .await?;
    tracing::debug!("Inserting translations: {:?}", result);
    Ok(())
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
            let provider = get_metadata_provider(entity.lot, entity.source, ss).await?;
            if let Ok(trn) = provider
                .translate_metadata(
                    &entity.identifier,
                    &preferred_language,
                    input.show_extra_information.as_ref(),
                    input.podcast_extra_information.as_ref(),
                )
                .await
            {
                let value = translation_value_for_variant(input.variant, &trn);
                upsert_entity_translation(&input, &preferred_language, value, ss).await?;
            }
            if input.show_extra_information.is_none() && input.podcast_extra_information.is_none() {
                let mut item: metadata::ActiveModel = entity.into();
                item.last_updated_on = ActiveValue::Set(Utc::now());
                item.update(&ss.db).await?;
            }
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
            let provider = get_metadata_provider(entity.lot, entity.source, ss).await?;
            if let Ok(trn) = provider
                .translate_metadata_group(&entity.identifier, &preferred_language)
                .await
            {
                let value = translation_value_for_variant(input.variant, &trn);
                upsert_entity_translation(&input, &preferred_language, value, ss).await?;
            }
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
            let provider = get_non_metadata_provider(person.source, ss).await?;
            if let Ok(trn) = provider
                .translate_person(
                    &person.identifier,
                    &preferred_language,
                    &person.source_specifics,
                )
                .await
            {
                let value = translation_value_for_variant(input.variant, &trn);
                upsert_entity_translation(&input, &preferred_language, value, ss).await?;
            }
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
            input.show_extra_information,
            input.podcast_extra_information,
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
        input.show_extra_information.clone(),
        input.podcast_extra_information.clone(),
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
        show_extra_information: input.show_extra_information,
        podcast_extra_information: input.podcast_extra_information,
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
    let preferred_language = get_preferred_language_for_input(user_id, &input, ss).await?;

    let query = EntityTranslation::find()
        .filter(entity_translation::Column::EntityId.eq(&input.entity_id))
        .filter(entity_translation::Column::EntityLot.eq(input.entity_lot))
        .filter(entity_translation::Column::Language.eq(&preferred_language))
        .filter(entity_translation::Column::Variant.eq(input.variant));
    let query = apply_extra_information_filters(
        query,
        &input.show_extra_information,
        &input.podcast_extra_information,
    );

    if let Some(translation) = query.one(&ss.db).await? {
        return Ok(MediaTranslationResult::Value(MediaTranslationValue {
            value: translation.value,
        }));
    }

    let cache_key = build_in_progress_cache_key(
        &input.entity_id,
        input.entity_lot,
        input.variant,
        &preferred_language,
        input.show_extra_information,
        input.podcast_extra_information,
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
