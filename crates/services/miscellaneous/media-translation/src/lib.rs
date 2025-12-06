use std::{collections::HashSet, sync::Arc};

use anyhow::{Result, anyhow, bail};
use background_models::{ApplicationJob, MpApplicationJob};
use chrono::Utc;
use common_models::{EntityWithLot, UserLevelCacheKey};
use common_utils::ryot_log;
use database_models::{
    entity_translation, metadata, metadata_group, person,
    prelude::{EntityTranslation, Metadata, MetadataGroup, Person},
};
use database_utils::user_by_id;
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CachedResponse, EntityTranslationDetailsResponse,
    ExpireCacheKeyInput,
};
use dependent_provider_utils::{get_metadata_provider, get_non_metadata_provider};
use enum_models::{EntityLot, EntityTranslationVariant, MediaSource};
use itertools::Itertools;
use media_models::EntityTranslationDetails;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter, QuerySelect,
    sea_query::OnConflict,
};
use supporting_service::SupportingService;
use user_models::UserProviderLanguagePreferences;

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

fn merge_languages(existing: &Option<Vec<String>>, preferred_language: &str) -> Vec<String> {
    let mut languages: HashSet<String> = HashSet::from_iter(existing.clone().unwrap_or_default());
    languages.insert(preferred_language.to_string());
    languages.into_iter().collect_vec()
}

fn build_translation_models(
    input: &EntityWithLot,
    preferred_language: &str,
    title: Option<String>,
    description: Option<String>,
) -> Vec<entity_translation::ActiveModel> {
    let model_for = |variant: EntityTranslationVariant, value: Option<String>| {
        let mut model = entity_translation::ActiveModel {
            variant: ActiveValue::Set(variant),
            value: ActiveValue::Set(value.filter(|v| !v.is_empty())),
            language: ActiveValue::Set(preferred_language.to_string()),
            ..Default::default()
        };
        match input.entity_lot {
            EntityLot::Person => {
                model.person_id = ActiveValue::Set(Some(input.entity_id.clone()));
            }
            EntityLot::Metadata => {
                model.metadata_id = ActiveValue::Set(Some(input.entity_id.clone()));
            }
            EntityLot::MetadataGroup => {
                model.metadata_group_id = ActiveValue::Set(Some(input.entity_id.clone()));
            }
            _ => {}
        }
        model
    };

    vec![
        model_for(EntityTranslationVariant::Title, title),
        model_for(EntityTranslationVariant::Description, description),
    ]
}

async fn replace_entity_translations(
    ss: &Arc<SupportingService>,
    input: &EntityWithLot,
    preferred_language: &str,
    title: Option<String>,
    description: Option<String>,
) -> Result<()> {
    EntityTranslation::delete_many()
        .filter(entity_translation::Column::EntityId.eq(&input.entity_id))
        .filter(entity_translation::Column::EntityLot.eq(input.entity_lot))
        .filter(entity_translation::Column::Language.eq(preferred_language))
        .exec(&ss.db)
        .await?;
    let translations = build_translation_models(input, preferred_language, title, description);
    let result = EntityTranslation::insert_many(translations)
        .on_conflict(OnConflict::new().do_nothing().to_owned())
        .exec_without_returning(&ss.db)
        .await?;
    ryot_log!(debug, "Inserting translations: {:?}", result);
    Ok(())
}

pub async fn update_media_translation(
    ss: &Arc<SupportingService>,
    user_id: &String,
    input: EntityWithLot,
) -> Result<()> {
    match input.entity_lot {
        EntityLot::Metadata => {
            let meta = Metadata::find_by_id(&input.entity_id)
                .one(&ss.db)
                .await?
                .ok_or_else(|| anyhow!("Metadata not found"))?;
            let preferred_language =
                get_preferred_language_for_user_and_source(ss, user_id, &meta.source).await?;
            let provider = get_metadata_provider(meta.lot, meta.source, ss).await?;
            if let Ok(trn) = provider
                .translate_metadata(&meta.identifier, &preferred_language)
                .await
            {
                replace_entity_translations(
                    ss,
                    &input,
                    &preferred_language,
                    trn.title,
                    trn.description,
                )
                .await?;
            }

            let languages =
                merge_languages(&meta.has_translations_for_languages, &preferred_language);
            let mut item: metadata::ActiveModel = meta.into();
            item.last_updated_on = ActiveValue::Set(Utc::now());
            item.has_translations_for_languages = ActiveValue::Set(Some(languages));
            item.update(&ss.db).await?;
        }
        EntityLot::MetadataGroup => {
            let metadata_group = MetadataGroup::find_by_id(&input.entity_id)
                .one(&ss.db)
                .await?
                .ok_or_else(|| anyhow!("Metadata group not found"))?;
            let preferred_language =
                get_preferred_language_for_user_and_source(ss, user_id, &metadata_group.source)
                    .await?;
            let provider =
                get_metadata_provider(metadata_group.lot, metadata_group.source, ss).await?;
            if let Ok(trn) = provider
                .translate_metadata_group(&metadata_group.identifier, &preferred_language)
                .await
            {
                replace_entity_translations(
                    ss,
                    &input,
                    &preferred_language,
                    trn.title,
                    trn.description,
                )
                .await?;
            }

            let languages = merge_languages(
                &metadata_group.has_translations_for_languages,
                &preferred_language,
            );
            let mut item: metadata_group::ActiveModel = metadata_group.into();
            item.last_updated_on = ActiveValue::Set(Utc::now());
            item.has_translations_for_languages = ActiveValue::Set(Some(languages));
            item.update(&ss.db).await?;
        }
        EntityLot::Person => {
            let person = Person::find_by_id(&input.entity_id)
                .one(&ss.db)
                .await?
                .ok_or_else(|| anyhow!("Person not found"))?;
            let preferred_language =
                get_preferred_language_for_user_and_source(ss, user_id, &person.source).await?;
            let provider = get_non_metadata_provider(person.source, ss).await?;
            if let Ok(trn) = provider
                .translate_person(
                    &person.identifier,
                    &preferred_language,
                    &person.source_specifics,
                )
                .await
            {
                replace_entity_translations(
                    ss,
                    &input,
                    &preferred_language,
                    trn.title,
                    trn.description,
                )
                .await?;
            }

            let languages =
                merge_languages(&person.has_translations_for_languages, &preferred_language);
            let mut item: person::ActiveModel = person.into();
            item.last_updated_on = ActiveValue::Set(Utc::now());
            item.has_translations_for_languages = ActiveValue::Set(Some(languages));
            item.update(&ss.db).await?;
        }
        _ => {}
    };
    cache_service::expire_key(
        ss,
        ExpireCacheKeyInput::ByKey(Box::new(ApplicationCacheKey::UserEntityTranslations(
            UserLevelCacheKey {
                input: input.clone(),
                user_id: user_id.clone(),
            },
        ))),
    )
    .await?;
    Ok(())
}

pub async fn deploy_update_media_translations_job(
    user_id: String,
    input: EntityWithLot,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    ss.perform_application_job(ApplicationJob::Mp(
        MpApplicationJob::UpdateMediaTranslations(user_id, input),
    ))
    .await?;
    Ok(true)
}

pub async fn media_translations(
    user_id: &String,
    input: EntityWithLot,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<EntityTranslationDetailsResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserEntityTranslations(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.clone(),
        }),
        ApplicationCacheValue::UserEntityTranslations,
        || async move {
            let (source, has_translations_for_languages) = match input.entity_lot {
                EntityLot::Metadata => Metadata::find_by_id(&input.entity_id)
                    .select_only()
                    .column(metadata::Column::Source)
                    .column(metadata::Column::HasTranslationsForLanguages)
                    .into_tuple::<(MediaSource, Option<Vec<String>>)>()
                    .one(&ss.db)
                    .await?
                    .ok_or_else(|| anyhow!("Metadata not found"))?,
                EntityLot::MetadataGroup => MetadataGroup::find_by_id(&input.entity_id)
                    .select_only()
                    .column(metadata_group::Column::Source)
                    .column(metadata_group::Column::HasTranslationsForLanguages)
                    .into_tuple::<(MediaSource, Option<Vec<String>>)>()
                    .one(&ss.db)
                    .await?
                    .ok_or_else(|| anyhow!("Metadata group not found"))?,
                EntityLot::Person => Person::find_by_id(&input.entity_id)
                    .select_only()
                    .column(person::Column::Source)
                    .column(person::Column::HasTranslationsForLanguages)
                    .into_tuple::<(MediaSource, Option<Vec<String>>)>()
                    .one(&ss.db)
                    .await?
                    .ok_or_else(|| anyhow!("Person not found"))?,
                _ => {
                    bail!("Unsupported entity lot for translations");
                }
            };
            let preferred_language =
                get_preferred_language_for_user_and_source(ss, user_id, &source).await?;
            let translations = EntityTranslation::find()
                .filter(entity_translation::Column::EntityId.eq(input.entity_id))
                .filter(entity_translation::Column::EntityLot.eq(input.entity_lot))
                .filter(entity_translation::Column::Language.eq(&preferred_language))
                .all(&ss.db)
                .await?;
            if translations.is_empty() {
                if has_translations_for_languages
                    .unwrap_or_default()
                    .contains(&preferred_language)
                {
                    return Ok(Some(EntityTranslationDetails::default()));
                }
                return Ok(None);
            }
            Ok(Some(EntityTranslationDetails {
                title: translations
                    .iter()
                    .find(|s| s.variant == EntityTranslationVariant::Title)
                    .and_then(|s| s.value.clone()),
                description: translations
                    .iter()
                    .find(|s| s.variant == EntityTranslationVariant::Description)
                    .and_then(|s| s.value.clone()),
            }))
        },
    )
    .await
}
