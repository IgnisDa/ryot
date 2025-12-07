use std::{collections::HashMap, iter::zip, sync::Arc};

use anyhow::{Result, anyhow, bail};
use background_models::{ApplicationJob, LpApplicationJob};
use chrono::Utc;
use common_models::{EntityAssets, EntityWithLot, PersonSourceSpecifics, StringIdObject};
use common_utils::{
    MAX_IMPORT_RETRIES_FOR_PARTIAL_STATE, SHOW_SPECIAL_SEASON_NAMES, ryot_log, sleep_for_n_seconds,
};
use database_models::{
    genre, metadata, metadata_group, metadata_group_to_person, metadata_to_genre,
    metadata_to_metadata, metadata_to_metadata_group, metadata_to_person, person,
    prelude::{
        Genre, Metadata, MetadataGroup, MetadataGroupToPerson, MetadataToGenre, MetadataToMetadata,
        MetadataToMetadataGroup, MetadataToPerson, Person,
    },
};
use dependent_jobs_utils::deploy_update_media_entity_job;
use dependent_models::MetadataBaseData;
use dependent_provider_utils::{
    details_from_provider, get_metadata_provider, get_non_metadata_provider,
};
use dependent_utility_utils::{
    expire_metadata_details_cache, expire_metadata_group_details_cache, expire_person_details_cache,
};
use enum_models::{EntityLot, MetadataToMetadataRelation, UserNotificationContent};
use futures::{TryFutureExt, try_join};
use itertools::Itertools;
use markdown::{CompileOptions, Options, to_html_with_options as markdown_to_html_opts};
use media_models::{
    CommitMetadataGroupInput, CommitPersonInput, GenreListItem, MediaAssociatedPersonStateChanges,
    MetadataCreator, MetadataCreatorsGroupedByRole, MetadataDetails, PartialMetadataPerson,
    PartialMetadataWithoutId, UniqueMediaIdentifier, UpdateMediaEntityResult,
};
use nanoid::nanoid;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, FromQueryResult, IntoActiveModel,
    ModelTrait, QueryFilter, QueryOrder, QuerySelect, RelationTrait,
    sea_query::{Asterisk, Condition, Expr, JoinType, OnConflict},
};
use supporting_service::SupportingService;
use traits::TraceOk;

async fn ensure_metadata_updated(
    metadata_id: &String,
    ss: &Arc<SupportingService>,
    ensure_updated: Option<bool>,
) -> Result<bool> {
    match ensure_updated {
        Some(true) => {
            let mut success = false;
            for attempt in 0..MAX_IMPORT_RETRIES_FOR_PARTIAL_STATE {
                let is_partial = Metadata::find_by_id(metadata_id)
                    .select_only()
                    .column(metadata::Column::IsPartial)
                    .into_tuple::<Option<bool>>()
                    .one(&ss.db)
                    .await?
                    .flatten()
                    .unwrap_or(false);
                if is_partial {
                    deploy_update_media_entity_job(
                        EntityWithLot {
                            entity_id: metadata_id.to_owned(),
                            entity_lot: EntityLot::Metadata,
                        },
                        ss,
                    )
                    .await?;
                    let sleep_time = u64::pow(2, (attempt + 1).try_into().unwrap());
                    ryot_log!(debug, "Sleeping for {}s before metadata check", sleep_time);
                    sleep_for_n_seconds(sleep_time).await;
                } else {
                    success = true;
                    break;
                }
            }
            Ok(success)
        }
        _ => Ok(true),
    }
}

pub async fn commit_metadata(
    data: PartialMetadataWithoutId,
    ss: &Arc<SupportingService>,
    ensure_updated: Option<bool>,
) -> Result<(metadata::Model, bool)> {
    let mode = match Metadata::find()
        .filter(metadata::Column::Identifier.eq(&data.identifier))
        .filter(metadata::Column::Lot.eq(data.lot))
        .filter(metadata::Column::Source.eq(data.source))
        .one(&ss.db)
        .await
        .unwrap()
    {
        Some(c) => c,
        None => {
            let mut assets = EntityAssets::default();
            if let Some(i) = data.image.clone() {
                assets.remote_images = vec![i];
            }
            let c = metadata::ActiveModel {
                assets: ActiveValue::Set(assets),
                lot: ActiveValue::Set(data.lot),
                title: ActiveValue::Set(data.title),
                source: ActiveValue::Set(data.source),
                is_partial: ActiveValue::Set(Some(true)),
                identifier: ActiveValue::Set(data.identifier),
                publish_year: ActiveValue::Set(data.publish_year),
                ..Default::default()
            };
            c.insert(&ss.db).await?
        }
    };
    let was_updated_successfully = ensure_metadata_updated(&mode.id, ss, ensure_updated).await?;

    let final_metadata = match (was_updated_successfully, ensure_updated) {
        (true, Some(true)) => Metadata::find_by_id(&mode.id).one(&ss.db).await?.unwrap(),
        _ => mode,
    };

    Ok((final_metadata, was_updated_successfully))
}

pub async fn change_metadata_associations(
    metadata_id: &String,
    genres: Vec<String>,
    suggestions: Vec<PartialMetadataWithoutId>,
    groups: Vec<CommitMetadataGroupInput>,
    people: Vec<PartialMetadataPerson>,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    for (index, person) in people.into_iter().enumerate() {
        let role = person.role.clone();
        let db_person = commit_person(
            CommitPersonInput {
                name: person.name,
                source: person.source,
                identifier: person.identifier.clone(),
                source_specifics: person.source_specifics,
                ..Default::default()
            },
            ss,
        )
        .await?;
        insert_metadata_person_links(
            ss,
            metadata_id,
            vec![(
                db_person.id,
                role,
                person.character,
                Some(index.try_into().unwrap()),
            )],
        )
        .await?;
    }

    for name in genres {
        let maybe_genre = Genre::find()
            .filter(genre::Column::Name.eq(&name))
            .one(&ss.db)
            .await?;
        let genre = match maybe_genre {
            Some(g) => g,
            None => {
                genre::ActiveModel {
                    name: ActiveValue::Set(name.clone()),
                    id: ActiveValue::Set(format!("gen_{}", nanoid!(12))),
                }
                .insert(&ss.db)
                .await?
            }
        };

        let intermediate = metadata_to_genre::ActiveModel {
            genre_id: ActiveValue::Set(genre.id),
            metadata_id: ActiveValue::Set(metadata_id.to_owned()),
        };
        MetadataToGenre::insert(intermediate)
            .on_conflict(OnConflict::new().do_nothing().to_owned())
            .exec_without_returning(&ss.db)
            .await?;
    }

    for data in suggestions {
        let (db_partial_metadata, _) = commit_metadata(data, ss, None).await?;
        let intermediate = metadata_to_metadata::ActiveModel {
            from_metadata_id: ActiveValue::Set(metadata_id.to_owned()),
            to_metadata_id: ActiveValue::Set(db_partial_metadata.id.clone()),
            relation: ActiveValue::Set(MetadataToMetadataRelation::Suggestion),
            ..Default::default()
        };
        MetadataToMetadata::insert(intermediate)
            .on_conflict(OnConflict::new().do_nothing().to_owned())
            .exec_without_returning(&ss.db)
            .await?;
    }

    for metadata_group in groups {
        let db_group = commit_metadata_group(metadata_group, ss).await?;
        let intermediate = metadata_to_metadata_group::ActiveModel {
            metadata_group_id: ActiveValue::Set(db_group.id),
            metadata_id: ActiveValue::Set(metadata_id.to_owned()),
            ..Default::default()
        };
        MetadataToMetadataGroup::insert(intermediate)
            .on_conflict(OnConflict::new().do_nothing().to_owned())
            .exec_without_returning(&ss.db)
            .await?;
    }

    Ok(())
}

pub async fn insert_metadata_person_links(
    ss: &Arc<SupportingService>,
    metadata_id: &str,
    links: Vec<(String, String, Option<String>, Option<i32>)>,
) -> Result<()> {
    for (person_id, role, character, index) in links.into_iter() {
        let intermediate = metadata_to_person::ActiveModel {
            role: ActiveValue::Set(role),
            index: ActiveValue::Set(index),
            person_id: ActiveValue::Set(person_id),
            character: ActiveValue::Set(character),
            metadata_id: ActiveValue::Set(metadata_id.to_owned()),
        };
        MetadataToPerson::insert(intermediate)
            .on_conflict(OnConflict::new().do_nothing().to_owned())
            .exec_without_returning(&ss.db)
            .await?;
    }
    Ok(())
}

pub async fn insert_metadata_group_links(
    ss: &Arc<SupportingService>,
    metadata_id: &str,
    links: Vec<(String, Option<i32>)>,
) -> Result<()> {
    for (metadata_group_id, part) in links.into_iter() {
        let intermediate = metadata_to_metadata_group::ActiveModel {
            part: ActiveValue::Set(part),
            metadata_id: ActiveValue::Set(metadata_id.to_owned()),
            metadata_group_id: ActiveValue::Set(metadata_group_id),
        };
        MetadataToMetadataGroup::insert(intermediate)
            .on_conflict(OnConflict::new().do_nothing().to_owned())
            .exec_without_returning(&ss.db)
            .await?;
    }
    Ok(())
}

async fn generate_metadata_update_notifications(
    meta: &metadata::Model,
    details: &MetadataDetails,
    ss: &Arc<SupportingService>,
) -> Result<Vec<UserNotificationContent>> {
    let make_eligible_for_smart_collection = || {
        ss.perform_application_job(ApplicationJob::Lp(
            LpApplicationJob::HandleMetadataEligibleForSmartCollectionMoving(meta.id.clone()),
        ))
    };
    let mut notifications = vec![];

    if let (Some(p1), Some(p2)) = (&meta.production_status, &details.production_status)
        && p1 != p2
    {
        notifications.push(UserNotificationContent::MetadataStatusChanged {
            old_status: format!("{p1:#?}"),
            new_status: format!("{p2:#?}"),
            entity_title: meta.title.clone(),
        });
    }
    if let (Some(p1), Some(p2)) = (meta.publish_year, details.publish_year)
        && p1 != p2
    {
        notifications.push(UserNotificationContent::MetadataReleaseDateChanged {
            season_number: None,
            episode_number: None,
            old_date: format!("{p1:#?}"),
            new_date: format!("{p2:#?}"),
            entity_title: meta.title.clone(),
        });
    }
    if let (Some(s1), Some(s2)) = (&meta.show_specifics, &details.show_specifics) {
        if s1.seasons.len() != s2.seasons.len() {
            notifications.push(UserNotificationContent::MetadataNumberOfSeasonsChanged {
                old_seasons: s1.seasons.len(),
                new_seasons: s2.seasons.len(),
                entity_title: meta.title.clone(),
            });
            make_eligible_for_smart_collection().await?;
        } else {
            for (s1, s2) in zip(s1.seasons.iter(), s2.seasons.iter()) {
                if SHOW_SPECIAL_SEASON_NAMES.contains(&s1.name.as_str())
                    && SHOW_SPECIAL_SEASON_NAMES.contains(&s2.name.as_str())
                {
                    continue;
                }
                if s1.episodes.len() != s2.episodes.len() {
                    notifications.push(UserNotificationContent::MetadataEpisodeReleased {
                        entity_title: meta.title.clone(),
                        old_episode_count: s1.episodes.len(),
                        new_episode_count: s2.episodes.len(),
                        season_number: Some(s1.season_number),
                    });
                    make_eligible_for_smart_collection().await?;
                } else {
                    for (before_episode, after_episode) in
                        zip(s1.episodes.iter(), s2.episodes.iter())
                    {
                        if before_episode.name != after_episode.name {
                            notifications.push(
                                UserNotificationContent::MetadataEpisodeNameChanged {
                                    entity_title: meta.title.clone(),
                                    season_number: Some(s1.season_number),
                                    episode_number: before_episode.episode_number,
                                    new_name: format!("{:#?}", after_episode.name),
                                    old_name: format!("{:#?}", before_episode.name),
                                },
                            );
                        }
                        if before_episode.poster_images != after_episode.poster_images {
                            notifications.push(
                                UserNotificationContent::MetadataEpisodeImagesChanged {
                                    entity_title: meta.title.clone(),
                                    season_number: Some(s1.season_number),
                                    episode_number: before_episode.episode_number,
                                },
                            );
                        }
                        if let (Some(pd1), Some(pd2)) =
                            (before_episode.publish_date, after_episode.publish_date)
                            && pd1 != pd2
                        {
                            notifications.push(
                                UserNotificationContent::MetadataReleaseDateChanged {
                                    old_date: format!("{:?}", pd1),
                                    new_date: format!("{:?}", pd2),
                                    entity_title: meta.title.clone(),
                                    season_number: Some(s1.season_number),
                                    episode_number: Some(before_episode.episode_number),
                                },
                            );
                        }
                    }
                }
            }
        }
    }
    if let (Some(a1), Some(a2)) = (&meta.anime_specifics, &details.anime_specifics)
        && let (Some(e1), Some(e2)) = (a1.episodes, a2.episodes)
        && e1 != e2
    {
        notifications.push(UserNotificationContent::MetadataChaptersOrEpisodesChanged {
            old_count: e1.into(),
            new_count: e2.into(),
            entity_title: meta.title.clone(),
            content_type: "episodes".to_string(),
        });
        make_eligible_for_smart_collection().await?;
    }
    if let (Some(m1), Some(m2)) = (&meta.manga_specifics, &details.manga_specifics)
        && let (Some(c1), Some(c2)) = (m1.chapters, m2.chapters)
        && c1 != c2
    {
        notifications.push(UserNotificationContent::MetadataChaptersOrEpisodesChanged {
            old_count: c1,
            new_count: c2,
            entity_title: meta.title.clone(),
            content_type: "chapters".to_string(),
        });
        make_eligible_for_smart_collection().await?;
    }
    if let (Some(p1), Some(p2)) = (&meta.podcast_specifics, &details.podcast_specifics) {
        if p1.episodes.len() != p2.episodes.len() {
            notifications.push(UserNotificationContent::MetadataEpisodeReleased {
                season_number: None,
                entity_title: meta.title.clone(),
                old_episode_count: p1.episodes.len(),
                new_episode_count: p2.episodes.len(),
            });
            make_eligible_for_smart_collection().await?;
        } else {
            for (before_episode, after_episode) in zip(p1.episodes.iter(), p2.episodes.iter()) {
                if before_episode.title != after_episode.title {
                    notifications.push(UserNotificationContent::MetadataEpisodeNameChanged {
                        season_number: None,
                        entity_title: meta.title.clone(),
                        episode_number: before_episode.number,
                        old_name: format!("{:#?}", before_episode.title),
                        new_name: format!("{:#?}", after_episode.title),
                    });
                }
                if before_episode.thumbnail != after_episode.thumbnail {
                    notifications.push(UserNotificationContent::MetadataEpisodeImagesChanged {
                        season_number: None,
                        entity_title: meta.title.clone(),
                        episode_number: before_episode.number,
                    });
                }
            }
        }
    }

    Ok(notifications)
}

pub async fn update_metadata(
    metadata_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<UpdateMediaEntityResult> {
    let meta = Metadata::find_by_id(metadata_id)
        .one(&ss.db)
        .await
        .unwrap()
        .unwrap();
    if !meta.is_partial.unwrap_or_default() {
        return Ok(UpdateMediaEntityResult::default());
    }

    let mut result = UpdateMediaEntityResult::default();
    ryot_log!(debug, "Updating metadata for {:?}", metadata_id);
    let maybe_details = details_from_provider(meta.lot, meta.source, &meta.identifier, ss).await;
    match maybe_details {
        Ok(details) => {
            let notifications = generate_metadata_update_notifications(&meta, &details, ss).await?;

            let free_creators = (!details.creators.is_empty())
                .then_some(())
                .map(|_| details.creators);
            let watch_providers = (!details.watch_providers.is_empty())
                .then_some(())
                .map(|_| details.watch_providers);

            let mut meta = meta.into_active_model();
            meta.is_partial = ActiveValue::Set(None);
            meta.title = ActiveValue::Set(details.title);
            meta.assets = ActiveValue::Set(details.assets);
            meta.is_nsfw = ActiveValue::Set(details.is_nsfw);
            meta.last_updated_on = ActiveValue::Set(Utc::now());
            meta.free_creators = ActiveValue::Set(free_creators);
            meta.source_url = ActiveValue::Set(details.source_url);
            meta.description = ActiveValue::Set(details.description);
            meta.watch_providers = ActiveValue::Set(watch_providers);
            meta.publish_year = ActiveValue::Set(details.publish_year);
            meta.publish_date = ActiveValue::Set(details.publish_date);
            meta.show_specifics = ActiveValue::Set(details.show_specifics);
            meta.book_specifics = ActiveValue::Set(details.book_specifics);
            meta.anime_specifics = ActiveValue::Set(details.anime_specifics);
            meta.provider_rating = ActiveValue::Set(details.provider_rating);
            meta.manga_specifics = ActiveValue::Set(details.manga_specifics);
            meta.movie_specifics = ActiveValue::Set(details.movie_specifics);
            meta.music_specifics = ActiveValue::Set(details.music_specifics);
            meta.production_status = ActiveValue::Set(details.production_status);
            meta.original_language = ActiveValue::Set(details.original_language);
            meta.podcast_specifics = ActiveValue::Set(details.podcast_specifics);
            meta.audio_book_specifics = ActiveValue::Set(details.audio_book_specifics);
            meta.video_game_specifics = ActiveValue::Set(details.video_game_specifics);
            meta.external_identifiers = ActiveValue::Set(details.external_identifiers);
            meta.visual_novel_specifics = ActiveValue::Set(details.visual_novel_specifics);
            let metadata = meta.update(&ss.db).await.unwrap();

            change_metadata_associations(
                &metadata.id,
                details.genres,
                details.suggestions,
                details.groups,
                details.people,
                ss,
            )
            .await?;
            ryot_log!(debug, "Updated metadata for {:?}", metadata_id);
            result.notifications.extend(notifications);
        }
        Err(e) => {
            ryot_log!(
                error,
                "Error while updating metadata = {:?}: {:?}",
                metadata_id,
                e
            );
        }
    };
    expire_metadata_details_cache(metadata_id, ss).await?;
    Ok(result)
}

pub async fn update_metadata_group(
    metadata_group_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<UpdateMediaEntityResult> {
    let metadata_group = MetadataGroup::find_by_id(metadata_group_id)
        .one(&ss.db)
        .await?
        .ok_or_else(|| anyhow!("Group not found"))?;
    if !metadata_group.is_partial.unwrap_or_default() {
        return Ok(UpdateMediaEntityResult::default());
    }

    let provider = get_metadata_provider(metadata_group.lot, metadata_group.source, ss).await?;
    let (group_details, associated_items) = provider
        .metadata_group_details(&metadata_group.identifier)
        .await?;
    let mut eg = metadata_group.into_active_model();
    eg.is_partial = ActiveValue::Set(None);
    eg.title = ActiveValue::Set(group_details.title);
    eg.parts = ActiveValue::Set(group_details.parts);
    eg.last_updated_on = ActiveValue::Set(Utc::now());
    eg.assets = ActiveValue::Set(group_details.assets);
    eg.source_url = ActiveValue::Set(group_details.source_url);
    eg.description = ActiveValue::Set(group_details.description);
    let eg = eg.update(&ss.db).await?;
    for (idx, media) in associated_items.into_iter().enumerate() {
        let (db_partial_metadata, _) = commit_metadata(media, ss, None).await?;
        MetadataToMetadataGroup::delete_many()
            .filter(metadata_to_metadata_group::Column::MetadataGroupId.eq(&eg.id))
            .filter(metadata_to_metadata_group::Column::MetadataId.eq(&db_partial_metadata.id))
            .exec(&ss.db)
            .await
            .ok();
        let intermediate = metadata_to_metadata_group::ActiveModel {
            metadata_group_id: ActiveValue::Set(eg.id.clone()),
            metadata_id: ActiveValue::Set(db_partial_metadata.id),
            part: ActiveValue::Set(Some((idx + 1).try_into().unwrap())),
        };
        intermediate.insert(&ss.db).await.ok();
    }
    expire_metadata_group_details_cache(metadata_group_id, ss).await?;
    Ok(UpdateMediaEntityResult::default())
}

pub async fn update_person(
    person_id: String,
    ss: &Arc<SupportingService>,
) -> Result<UpdateMediaEntityResult> {
    let person = Person::find_by_id(person_id.clone())
        .one(&ss.db)
        .await?
        .unwrap();
    if !person.is_partial.unwrap_or_default() {
        return Ok(UpdateMediaEntityResult::default());
    }

    let mut notifications = vec![];
    let provider = get_non_metadata_provider(person.source, ss).await?;
    let Some(provider_person) = provider
        .person_details(&person.identifier, &person.source_specifics)
        .await
        .trace_ok()
    else {
        bail!("Failed to retrieve person details");
    };
    ryot_log!(debug, "Updating person for {:?}", person_id);

    let mut current_state_changes = person.clone().state_changes.unwrap_or_default();
    let mut to_update_person = person.clone().into_active_model();
    to_update_person.is_partial = ActiveValue::Set(None);
    to_update_person.name = ActiveValue::Set(provider_person.name);
    to_update_person.last_updated_on = ActiveValue::Set(Utc::now());
    to_update_person.place = ActiveValue::Set(provider_person.place);
    to_update_person.gender = ActiveValue::Set(provider_person.gender);
    to_update_person.assets = ActiveValue::Set(provider_person.assets);
    to_update_person.website = ActiveValue::Set(provider_person.website);
    to_update_person.source_url = ActiveValue::Set(provider_person.source_url);
    to_update_person.birth_date = ActiveValue::Set(provider_person.birth_date);
    to_update_person.death_date = ActiveValue::Set(provider_person.death_date);
    to_update_person.description = ActiveValue::Set(provider_person.description);
    to_update_person.alternate_names = ActiveValue::Set(provider_person.alternate_names);
    for data in provider_person.related_metadata.clone() {
        let title = data.metadata.title.clone();
        let (pm, _) = commit_metadata(data.metadata, ss, None).await?;
        let already_intermediate = MetadataToPerson::find()
            .filter(metadata_to_person::Column::MetadataId.eq(&pm.id))
            .filter(metadata_to_person::Column::PersonId.eq(&person_id))
            .filter(metadata_to_person::Column::Role.eq(&data.role))
            .one(&ss.db)
            .await?;
        if already_intermediate.is_none() {
            let intermediate = metadata_to_person::ActiveModel {
                role: ActiveValue::Set(data.role.clone()),
                metadata_id: ActiveValue::Set(pm.id.clone()),
                person_id: ActiveValue::Set(person.id.clone()),
                character: ActiveValue::Set(data.character.clone()),
                ..Default::default()
            };
            intermediate.insert(&ss.db).await.unwrap();
        }
        let search_for = MediaAssociatedPersonStateChanges {
            role: data.role.clone(),
            media: UniqueMediaIdentifier {
                lot: pm.lot,
                source: pm.source,
                identifier: pm.identifier.clone(),
            },
        };
        if !current_state_changes
            .metadata_associated
            .contains(&search_for)
        {
            notifications.push(UserNotificationContent::PersonMetadataAssociated {
                metadata_title: title,
                role: data.role.clone(),
                person_name: person.name.clone(),
            });
            current_state_changes.metadata_associated.insert(search_for);
        }
    }
    for (idx, data) in provider_person.related_metadata_groups.iter().enumerate() {
        let db_dg = match MetadataGroup::find()
            .filter(metadata_group::Column::Lot.eq(data.metadata_group.lot))
            .filter(metadata_group::Column::Source.eq(data.metadata_group.source))
            .filter(metadata_group::Column::Identifier.eq(&data.metadata_group.identifier))
            .one(&ss.db)
            .await?
        {
            Some(m) => m.id,
            None => {
                let m = metadata_group::ActiveModel {
                    is_partial: ActiveValue::Set(Some(true)),
                    lot: ActiveValue::Set(data.metadata_group.lot),
                    source: ActiveValue::Set(data.metadata_group.source),
                    title: ActiveValue::Set(data.metadata_group.title.clone()),
                    assets: ActiveValue::Set(data.metadata_group.assets.clone()),
                    identifier: ActiveValue::Set(data.metadata_group.identifier.clone()),
                    ..Default::default()
                };
                m.insert(&ss.db).await?.id
            }
        };
        let already_intermediate = MetadataGroupToPerson::find()
            .filter(metadata_group_to_person::Column::Role.eq(&data.role))
            .filter(metadata_group_to_person::Column::PersonId.eq(&person_id))
            .filter(metadata_group_to_person::Column::MetadataGroupId.eq(&db_dg))
            .one(&ss.db)
            .await?;
        if already_intermediate.is_none() {
            let intermediate = metadata_group_to_person::ActiveModel {
                role: ActiveValue::Set(data.role.clone()),
                metadata_group_id: ActiveValue::Set(db_dg),
                index: ActiveValue::Set(idx.try_into().unwrap()),
                person_id: ActiveValue::Set(person_id.to_owned()),
            };
            intermediate.insert(&ss.db).await?;
        }
        let search_for = MediaAssociatedPersonStateChanges {
            role: data.role.clone(),
            media: UniqueMediaIdentifier {
                lot: data.metadata_group.lot,
                source: data.metadata_group.source,
                identifier: data.metadata_group.identifier.clone(),
            },
        };
        if !current_state_changes
            .metadata_groups_associated
            .contains(&search_for)
        {
            notifications.push(UserNotificationContent::PersonMetadataGroupAssociated {
                person_name: person.name.clone(),
                metadata_group_title: data.metadata_group.title.clone(),
                role: data.role.clone(),
            });
            current_state_changes
                .metadata_groups_associated
                .insert(search_for);
        }
    }
    to_update_person.state_changes = ActiveValue::Set(Some(current_state_changes));
    to_update_person.update(&ss.db).await.unwrap();
    expire_person_details_cache(&person_id, ss).await?;
    Ok(UpdateMediaEntityResult { notifications })
}

pub async fn commit_metadata_group(
    input: CommitMetadataGroupInput,
    ss: &Arc<SupportingService>,
) -> Result<StringIdObject> {
    match MetadataGroup::find()
        .filter(metadata_group::Column::Lot.eq(input.unique.lot))
        .filter(metadata_group::Column::Source.eq(input.unique.source))
        .filter(metadata_group::Column::Identifier.eq(&input.unique.identifier))
        .one(&ss.db)
        .await?
        .map(|m| StringIdObject { id: m.id })
    {
        Some(m) => Ok(m),
        None => {
            let mut assets = EntityAssets::default();
            if let Some(i) = input.image.clone() {
                assets.remote_images = vec![i];
            }
            let new_group = metadata_group::ActiveModel {
                assets: ActiveValue::Set(assets),
                title: ActiveValue::Set(input.name),
                lot: ActiveValue::Set(input.unique.lot),
                is_partial: ActiveValue::Set(Some(true)),
                source: ActiveValue::Set(input.unique.source),
                identifier: ActiveValue::Set(input.unique.identifier.clone()),
                parts: ActiveValue::Set(input.parts.unwrap_or_default().try_into().unwrap()),
                ..Default::default()
            };
            let new_group = new_group.insert(&ss.db).await?;
            Ok(StringIdObject { id: new_group.id })
        }
    }
}

pub async fn commit_person(
    data: CommitPersonInput,
    ss: &Arc<SupportingService>,
) -> Result<StringIdObject> {
    match Person::find()
        .filter(person::Column::Source.eq(data.source))
        .filter(person::Column::Identifier.eq(&data.identifier))
        .filter(match &data.source_specifics {
            None => person::Column::SourceSpecifics.is_null(),
            Some(specifics) if *specifics == PersonSourceSpecifics::default() => {
                person::Column::SourceSpecifics.is_null()
            }
            Some(specifics) => person::Column::SourceSpecifics.eq(Some(specifics.clone())),
        })
        .one(&ss.db)
        .await?
        .map(|p| StringIdObject { id: p.id })
    {
        Some(p) => Ok(p),
        None => {
            let mut assets = EntityAssets::default();
            if let Some(i) = data.image.clone() {
                assets.remote_images = vec![i];
            }
            let source_specifics = match &data.source_specifics {
                None => ActiveValue::Set(None),
                Some(specifics) if *specifics == PersonSourceSpecifics::default() => {
                    ActiveValue::Set(None)
                }
                Some(specifics) => ActiveValue::Set(Some(specifics.clone())),
            };
            let person = person::ActiveModel {
                source_specifics,
                assets: ActiveValue::Set(assets),
                name: ActiveValue::Set(data.name),
                source: ActiveValue::Set(data.source),
                is_partial: ActiveValue::Set(Some(true)),
                identifier: ActiveValue::Set(data.identifier),
                ..Default::default()
            };
            let person = person.insert(&ss.db).await?;
            Ok(StringIdObject { id: person.id })
        }
    }
}

pub async fn generic_metadata(
    metadata_id: &String,
    ss: &Arc<SupportingService>,
    ensure_updated: Option<bool>,
) -> Result<MetadataBaseData> {
    ensure_metadata_updated(metadata_id, ss, ensure_updated).await?;
    let Some(mut meta) = Metadata::find_by_id(metadata_id).one(&ss.db).await.unwrap() else {
        bail!("The record does not exist");
    };

    #[derive(Debug, FromQueryResult)]
    struct PartialCreator {
        id: String,
        role: String,
        character: Option<String>,
    }
    let (genres, crts, suggestions) = try_join!(
        meta.find_related(Genre)
            .order_by_asc(genre::Column::Name)
            .into_model::<GenreListItem>()
            .all(&ss.db)
            .map_err(|_| anyhow!("Failed to fetch genres")),
        MetadataToPerson::find()
            .expr(Expr::col(Asterisk))
            .filter(metadata_to_person::Column::MetadataId.eq(&meta.id))
            .join(
                JoinType::Join,
                metadata_to_person::Relation::Person
                    .def()
                    .on_condition(|left, right| {
                        Condition::all().add(
                            Expr::col((left, metadata_to_person::Column::PersonId))
                                .equals((right, person::Column::Id)),
                        )
                    }),
            )
            .order_by_asc(metadata_to_person::Column::Index)
            .into_model::<PartialCreator>()
            .all(&ss.db)
            .map_err(|_| anyhow!("Failed to fetch creators")),
        MetadataToMetadata::find()
            .select_only()
            .column(metadata_to_metadata::Column::ToMetadataId)
            .filter(metadata_to_metadata::Column::FromMetadataId.eq(&meta.id))
            .filter(
                metadata_to_metadata::Column::Relation.eq(MetadataToMetadataRelation::Suggestion)
            )
            .into_tuple::<String>()
            .all(&ss.db)
            .map_err(|_| anyhow!("Failed to fetch suggestions")),
    )?;

    let mut creators: HashMap<String, Vec<_>> = HashMap::new();
    for cr in crts {
        let creator = MetadataCreator {
            is_free: false,
            id_or_name: cr.id,
            character: cr.character,
        };
        creators
            .entry(cr.role)
            .and_modify(|e| {
                e.push(creator.clone());
            })
            .or_insert(vec![creator.clone()]);
    }
    if let Some(free_creators) = &meta.free_creators {
        for cr in free_creators.clone() {
            let creator = MetadataCreator {
                is_free: true,
                id_or_name: cr.name,
                ..Default::default()
            };
            creators
                .entry(cr.role)
                .and_modify(|e| {
                    e.push(creator.clone());
                })
                .or_insert(vec![creator.clone()]);
        }
    }
    if let Some(ref mut d) = meta.description {
        *d = markdown_to_html_opts(
            d,
            &Options {
                compile: CompileOptions {
                    allow_dangerous_html: true,
                    allow_dangerous_protocol: true,
                    ..CompileOptions::default()
                },
                ..Options::default()
            },
        )
        .unwrap();
    }
    let creators = creators
        .into_iter()
        .sorted_by(|(k1, _), (k2, _)| k1.cmp(k2))
        .map(|(name, items)| MetadataCreatorsGroupedByRole { name, items })
        .collect_vec();
    Ok(MetadataBaseData {
        genres,
        creators,
        model: meta,
        suggestions,
    })
}
