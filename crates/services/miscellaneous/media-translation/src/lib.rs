use std::{
    collections::{BTreeMap, HashSet},
    sync::Arc,
};

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
use enum_models::{EntityLot, EntityTranslationVariant, MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    EntityTranslationDetails, EpisodeTranslationDetails, PodcastTranslationExtraInformation,
    SeasonTranslationDetails, ShowTranslationExtraInformation,
};
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

fn build_translation_model(
    input: &EntityWithLot,
    variant: EntityTranslationVariant,
    value: Option<String>,
    preferred_language: &str,
) -> entity_translation::ActiveModel {
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
}

fn build_translation_models(
    input: &EntityWithLot,
    title: Option<String>,
    image: Option<String>,
    preferred_language: &str,
    description: Option<String>,
) -> Vec<entity_translation::ActiveModel> {
    vec![
        build_translation_model(
            input,
            EntityTranslationVariant::Title,
            title,
            preferred_language,
        ),
        build_translation_model(
            input,
            EntityTranslationVariant::Image,
            image,
            preferred_language,
        ),
        build_translation_model(
            input,
            EntityTranslationVariant::Description,
            description,
            preferred_language,
        ),
    ]
}

fn build_show_translation_models(
    input: &EntityWithLot,
    seasons: &[SeasonTranslationDetails],
    preferred_language: &str,
) -> Vec<entity_translation::ActiveModel> {
    let mut translations = Vec::new();
    for season in seasons {
        let season_extra = ShowTranslationExtraInformation {
            season_number: season.season_number,
            episode_number: None,
        };
        let mut title_model = build_translation_model(
            input,
            EntityTranslationVariant::Title,
            season.name.clone(),
            preferred_language,
        );
        title_model.show_extra_information = ActiveValue::Set(Some(season_extra.clone()));
        translations.push(title_model);
        let mut overview_model = build_translation_model(
            input,
            EntityTranslationVariant::Description,
            season.overview.clone(),
            preferred_language,
        );
        overview_model.show_extra_information = ActiveValue::Set(Some(season_extra));
        translations.push(overview_model);

        for episode in &season.episodes {
            let episode_extra = ShowTranslationExtraInformation {
                season_number: season.season_number,
                episode_number: Some(episode.episode_number),
            };
            let mut title_model = build_translation_model(
                input,
                EntityTranslationVariant::Title,
                episode.name.clone(),
                preferred_language,
            );
            title_model.show_extra_information = ActiveValue::Set(Some(episode_extra.clone()));
            translations.push(title_model);
            let mut overview_model = build_translation_model(
                input,
                EntityTranslationVariant::Description,
                episode.overview.clone(),
                preferred_language,
            );
            overview_model.show_extra_information = ActiveValue::Set(Some(episode_extra));
            translations.push(overview_model);
        }
    }
    translations
}

fn build_podcast_translation_models(
    input: &EntityWithLot,
    episodes: &[EpisodeTranslationDetails],
    preferred_language: &str,
) -> Vec<entity_translation::ActiveModel> {
    let mut translations = Vec::new();
    for episode in episodes {
        let episode_extra = PodcastTranslationExtraInformation {
            episode_number: episode.episode_number,
        };
        let mut title_model = build_translation_model(
            input,
            EntityTranslationVariant::Title,
            episode.name.clone(),
            preferred_language,
        );
        title_model.podcast_extra_information = ActiveValue::Set(Some(episode_extra.clone()));
        translations.push(title_model);
        let mut overview_model = build_translation_model(
            input,
            EntityTranslationVariant::Description,
            episode.overview.clone(),
            preferred_language,
        );
        overview_model.podcast_extra_information = ActiveValue::Set(Some(episode_extra));
        translations.push(overview_model);
    }
    translations
}

async fn replace_entity_translations(
    input: &EntityWithLot,
    translations: Vec<entity_translation::ActiveModel>,
    preferred_language: &str,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    EntityTranslation::delete_many()
        .filter(entity_translation::Column::EntityId.eq(&input.entity_id))
        .filter(entity_translation::Column::EntityLot.eq(input.entity_lot))
        .filter(entity_translation::Column::Language.eq(preferred_language))
        .exec(&ss.db)
        .await?;
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
            let entity = Metadata::find_by_id(&input.entity_id)
                .one(&ss.db)
                .await?
                .ok_or_else(|| anyhow!("Metadata not found"))?;
            let preferred_language =
                get_preferred_language_for_user_and_source(ss, user_id, &entity.source).await?;
            let provider = get_metadata_provider(entity.lot, entity.source, ss).await?;

            if let Ok(trn) = provider
                .translate_metadata(&entity.identifier, &preferred_language)
                .await
            {
                let mut translations = build_translation_models(
                    &input,
                    trn.title,
                    trn.image,
                    &preferred_language,
                    trn.description,
                );
                match entity.lot {
                    MediaLot::Show => {
                        if let Some(seasons) = trn.seasons.as_ref() {
                            translations.extend(build_show_translation_models(
                                &input,
                                seasons,
                                &preferred_language,
                            ));
                        }
                    }
                    MediaLot::Podcast => {
                        if let Some(episodes) = trn.episodes.as_ref() {
                            translations.extend(build_podcast_translation_models(
                                &input,
                                episodes,
                                &preferred_language,
                            ));
                        }
                    }
                    _ => {}
                }
                replace_entity_translations(&input, translations, &preferred_language, ss).await?;
            }

            let languages =
                merge_languages(&entity.has_translations_for_languages, &preferred_language);
            let mut item: metadata::ActiveModel = entity.into();
            item.last_updated_on = ActiveValue::Set(Utc::now());
            item.has_translations_for_languages = ActiveValue::Set(Some(languages));
            item.update(&ss.db).await?;
        }
        EntityLot::MetadataGroup => {
            let entity = MetadataGroup::find_by_id(&input.entity_id)
                .one(&ss.db)
                .await?
                .ok_or_else(|| anyhow!("Metadata group not found"))?;
            let preferred_language =
                get_preferred_language_for_user_and_source(ss, user_id, &entity.source).await?;
            let provider = get_metadata_provider(entity.lot, entity.source, ss).await?;

            if let Ok(trn) = provider
                .translate_metadata_group(&entity.identifier, &preferred_language)
                .await
            {
                let translations = build_translation_models(
                    &input,
                    trn.title,
                    trn.image,
                    &preferred_language,
                    trn.description,
                );
                replace_entity_translations(&input, translations, &preferred_language, ss).await?;
            }

            let languages =
                merge_languages(&entity.has_translations_for_languages, &preferred_language);
            let mut item: metadata_group::ActiveModel = entity.into();
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
                let translations = build_translation_models(
                    &input,
                    trn.title,
                    trn.image,
                    &preferred_language,
                    trn.description,
                );
                replace_entity_translations(&input, translations, &preferred_language, ss).await?;
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
                _ => bail!("Unsupported entity lot for translations"),
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
            let base_translations = translations
                .iter()
                .filter(|translation| {
                    translation.show_extra_information.is_none()
                        && translation.podcast_extra_information.is_none()
                })
                .collect_vec();
            let mut seasons_map: BTreeMap<i32, SeasonTranslationDetails> = BTreeMap::new();
            let mut episodes_map: BTreeMap<(i32, i32), EpisodeTranslationDetails> = BTreeMap::new();
            for translation in translations
                .iter()
                .filter(|translation| translation.show_extra_information.is_some())
            {
                let info = translation
                    .show_extra_information
                    .as_ref()
                    .ok_or_else(|| anyhow!("Show translation missing extra information"))?;
                match info.episode_number {
                    Some(episode_number) => {
                        let episode = episodes_map
                            .entry((info.season_number, episode_number))
                            .or_insert_with(|| EpisodeTranslationDetails {
                                episode_number,
                                ..Default::default()
                            });
                        match translation.variant {
                            EntityTranslationVariant::Title => {
                                episode.name = translation.value.clone();
                            }
                            EntityTranslationVariant::Description => {
                                episode.overview = translation.value.clone();
                            }
                            _ => {}
                        }
                    }
                    None => {
                        let season = seasons_map.entry(info.season_number).or_insert_with(|| {
                            SeasonTranslationDetails {
                                season_number: info.season_number,
                                episodes: Vec::new(),
                                ..Default::default()
                            }
                        });
                        match translation.variant {
                            EntityTranslationVariant::Title => {
                                season.name = translation.value.clone();
                            }
                            EntityTranslationVariant::Description => {
                                season.overview = translation.value.clone();
                            }
                            _ => {}
                        }
                    }
                }
            }
            for ((season_number, _), episode) in episodes_map {
                seasons_map
                    .entry(season_number)
                    .or_insert_with(|| SeasonTranslationDetails {
                        season_number,
                        episodes: Vec::new(),
                        ..Default::default()
                    })
                    .episodes
                    .push(episode);
            }
            let seasons =
                (!seasons_map.is_empty()).then_some(seasons_map.into_values().collect_vec());

            let mut podcast_episodes_map: BTreeMap<i32, EpisodeTranslationDetails> =
                BTreeMap::new();
            for translation in translations
                .iter()
                .filter(|translation| translation.podcast_extra_information.is_some())
            {
                let info = translation
                    .podcast_extra_information
                    .as_ref()
                    .ok_or_else(|| anyhow!("Podcast translation missing extra information"))?;
                let episode = podcast_episodes_map
                    .entry(info.episode_number)
                    .or_insert_with(|| EpisodeTranslationDetails {
                        episode_number: info.episode_number,
                        ..Default::default()
                    });
                match translation.variant {
                    EntityTranslationVariant::Title => {
                        episode.name = translation.value.clone();
                    }
                    EntityTranslationVariant::Description => {
                        episode.overview = translation.value.clone();
                    }
                    _ => {}
                }
            }
            let episodes = (!podcast_episodes_map.is_empty())
                .then_some(podcast_episodes_map.into_values().collect_vec());
            Ok(Some(EntityTranslationDetails {
                image: base_translations
                    .iter()
                    .find(|s| s.variant == EntityTranslationVariant::Image)
                    .and_then(|s| s.value.clone()),
                title: base_translations
                    .iter()
                    .find(|s| s.variant == EntityTranslationVariant::Title)
                    .and_then(|s| s.value.clone()),
                description: base_translations
                    .iter()
                    .find(|s| s.variant == EntityTranslationVariant::Description)
                    .and_then(|s| s.value.clone()),
                seasons,
                episodes,
            }))
        },
    )
    .await
}
