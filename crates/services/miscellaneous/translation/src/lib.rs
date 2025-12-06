use std::sync::Arc;

use anyhow::{Result, anyhow, bail};
use background_models::{ApplicationJob, MpApplicationJob};
use common_models::{EntityWithLot, UserLevelCacheKey};
use common_utils::ryot_log;
use database_models::{
    entity_translation, metadata,
    prelude::{EntityTranslation, Metadata},
};
use database_utils::user_by_id;
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CachedResponse, EntityTranslationDetailsResponse,
    ExpireCacheKeyInput,
};
use dependent_provider_utils::get_metadata_provider;
use enum_models::{EntityLot, EntityTranslationVariant, MediaSource};
use media_models::EntityTranslationDetails;
use sea_orm::{
    ActiveValue, ColumnTrait, EntityTrait, QueryFilter, QuerySelect, sea_query::OnConflict,
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

pub async fn deploy_update_entity_translations_job(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: EntityWithLot,
) -> Result<bool> {
    ss.perform_application_job(ApplicationJob::Mp(
        MpApplicationJob::UpdateEntityTranslations(user_id, input),
    ))
    .await?;
    Ok(true)
}

pub async fn update_media_entity_translation(
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
            let trn = match provider
                .translate_metadata(&meta.identifier, &preferred_language)
                .await
            {
                Ok(translation) => translation,
                Err(_) => bail!("Translation not found from provider"),
            };
            EntityTranslation::delete_many()
                .filter(entity_translation::Column::EntityId.eq(&input.entity_id))
                .filter(entity_translation::Column::EntityLot.eq(input.entity_lot))
                .filter(entity_translation::Column::Language.eq(&preferred_language))
                .exec(&ss.db)
                .await?;
            let translations = [
                (EntityTranslationVariant::Title, trn.title),
                (EntityTranslationVariant::Description, trn.description),
            ]
            .into_iter()
            .map(|(variant, value)| entity_translation::ActiveModel {
                variant: ActiveValue::Set(variant),
                language: ActiveValue::Set(preferred_language.clone()),
                value: ActiveValue::Set(value.filter(|v| !v.is_empty())),
                metadata_id: ActiveValue::Set(Some(input.entity_id.clone())),
                ..Default::default()
            })
            .collect::<Vec<_>>();
            let result = EntityTranslation::insert_many(translations)
                .on_conflict(OnConflict::new().do_nothing().to_owned())
                .exec_without_returning(&ss.db)
                .await?;
            ryot_log!(debug, "Inserting translations: {:?}", result);
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

pub async fn entity_translations(
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
            let source = match input.entity_lot {
                EntityLot::Metadata => Metadata::find_by_id(&input.entity_id)
                    .select_only()
                    .column(metadata::Column::Source)
                    .into_tuple::<MediaSource>()
                    .one(&ss.db)
                    .await?
                    .ok_or_else(|| anyhow!("Metadata not found"))?,
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
