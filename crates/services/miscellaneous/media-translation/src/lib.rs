use std::{collections::HashSet, sync::Arc};

use anyhow::{Result, anyhow, bail};
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
        macro_rules! set_id {
            ($field:ident) => {
                model.$field = ActiveValue::Set(Some(input.entity_id.clone()))
            };
        }
        match input.entity_lot {
            EntityLot::Person => set_id!(person_id),
            EntityLot::Metadata => set_id!(metadata_id),
            EntityLot::MetadataGroup => set_id!(metadata_group_id),
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
    input: &EntityWithLot,
    title: Option<String>,
    preferred_language: &str,
    description: Option<String>,
    ss: &Arc<SupportingService>,
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
    macro_rules! update_metadata_translation {
        ($entity_type:ident, $mod:ident, $method:ident) => {{
            let entity = $entity_type::find_by_id(&input.entity_id)
                .one(&ss.db)
                .await?
                .ok_or_else(|| anyhow!(concat!(stringify!($entity_type), " not found")))?;
            let preferred_language =
                get_preferred_language_for_user_and_source(ss, user_id, &entity.source).await?;

            let provider = get_metadata_provider(entity.lot, entity.source, ss).await?;

            if let Ok(trn) = provider
                .$method(&entity.identifier, &preferred_language)
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
                merge_languages(&entity.has_translations_for_languages, &preferred_language);
            let mut item: $mod::ActiveModel = entity.into();
            item.last_updated_on = ActiveValue::Set(Utc::now());
            item.has_translations_for_languages = ActiveValue::Set(Some(languages));
            item.update(&ss.db).await?;
        }};
    }

    match input.entity_lot {
        EntityLot::Metadata => update_metadata_translation!(Metadata, metadata, translate_metadata),
        EntityLot::MetadataGroup => {
            update_metadata_translation!(MetadataGroup, metadata_group, translate_metadata_group)
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
                    &input,
                    trn.title,
                    &preferred_language,
                    trn.description,
                    ss,
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
            macro_rules! fetch_info {
                ($entity:ident, $mod:ident, $name:literal) => {
                    $entity::find_by_id(&input.entity_id)
                        .select_only()
                        .column($mod::Column::Source)
                        .column($mod::Column::HasTranslationsForLanguages)
                        .into_tuple::<(MediaSource, Option<Vec<String>>)>()
                        .one(&ss.db)
                        .await?
                        .ok_or_else(|| anyhow!(concat!($name, " not found")))?
                };
            }

            let (source, has_translations_for_languages) = match input.entity_lot {
                EntityLot::Person => fetch_info!(Person, person, "Person"),
                EntityLot::Metadata => fetch_info!(Metadata, metadata, "Metadata"),
                EntityLot::MetadataGroup => {
                    fetch_info!(MetadataGroup, metadata_group, "Metadata group")
                }
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
                image: translations
                    .iter()
                    .find(|s| s.variant == EntityTranslationVariant::Image)
                    .and_then(|s| s.value.clone()),
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
