use async_graphql::{Error, Result};
use chrono::Utc;
use common_models::EntityAssets;
use common_models::StringIdObject;
use common_utils::{SHOW_SPECIAL_SEASON_NAMES, ryot_log};
use database_models::{
    genre, metadata, metadata_group, metadata_group_to_person, metadata_to_genre,
    metadata_to_metadata, metadata_to_metadata_group, metadata_to_person, person,
    prelude::{
        Genre, Metadata, MetadataGroup, MetadataGroupToPerson, MetadataToGenre, MetadataToMetadata,
        MetadataToMetadataGroup, MetadataToPerson, Person,
    },
};
use database_utils::transform_entity_assets;
use dependent_models::MetadataBaseData;
use enum_models::{MetadataToMetadataRelation, UserNotificationContent};
use itertools::Itertools;
use markdown::{CompileOptions, Options, to_html_with_options as markdown_to_html_opts};
use media_models::{
    CommitMetadataGroupInput, CommitPersonInput, GenreListItem, MediaAssociatedPersonStateChanges,
    MetadataCreator, MetadataCreatorGroupedByRole, PartialMetadata, PartialMetadataPerson,
    PartialMetadataWithoutId, UniqueMediaIdentifier, UpdateMediaEntityResult,
};
use nanoid::nanoid;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, FromQueryResult, ModelTrait,
    QueryFilter, QueryOrder, QuerySelect, RelationTrait,
};
use sea_query::{Asterisk, Condition, Expr, JoinType, OnConflict};
use std::{collections::HashMap, iter::zip, sync::Arc};
use supporting_service::SupportingService;

use crate::details_from_provider;
use crate::get_non_metadata_provider;

pub async fn commit_metadata(
    data: PartialMetadataWithoutId,
    ss: &Arc<SupportingService>,
) -> Result<PartialMetadata> {
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
    let model = PartialMetadata {
        id: mode.id,
        lot: mode.lot,
        image: data.image,
        title: mode.title,
        source: mode.source,
        identifier: mode.identifier,
        publish_year: mode.publish_year,
    };
    Ok(model)
}

pub async fn change_metadata_associations(
    metadata_id: &String,
    genres: Vec<String>,
    suggestions: Vec<PartialMetadataWithoutId>,
    groups: Vec<CommitMetadataGroupInput>,
    people: Vec<PartialMetadataPerson>,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    MetadataToPerson::delete_many()
        .filter(metadata_to_person::Column::MetadataId.eq(metadata_id))
        .exec(&ss.db)
        .await?;
    MetadataToGenre::delete_many()
        .filter(metadata_to_genre::Column::MetadataId.eq(metadata_id))
        .exec(&ss.db)
        .await?;
    MetadataToMetadata::delete_many()
        .filter(metadata_to_metadata::Column::FromMetadataId.eq(metadata_id))
        .filter(metadata_to_metadata::Column::Relation.eq(MetadataToMetadataRelation::Suggestion))
        .exec(&ss.db)
        .await?;

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
        let intermediate = metadata_to_person::ActiveModel {
            role: ActiveValue::Set(role),
            person_id: ActiveValue::Set(db_person.id),
            character: ActiveValue::Set(person.character),
            metadata_id: ActiveValue::Set(metadata_id.to_owned()),
            index: ActiveValue::Set(Some(index.try_into().unwrap())),
        };
        intermediate.insert(&ss.db).await.ok();
    }

    for name in genres {
        let genre = genre::ActiveModel {
            id: ActiveValue::Set(format!("gen_{}", nanoid!(12))),
            name: ActiveValue::Set(name.clone()),
        };
        let db_genre = Genre::insert(genre)
            .on_conflict(
                OnConflict::column(genre::Column::Name)
                    .update_column(genre::Column::Name)
                    .to_owned(),
            )
            .exec_with_returning(&ss.db)
            .await?;

        let intermediate = metadata_to_genre::ActiveModel {
            genre_id: ActiveValue::Set(db_genre.id),
            metadata_id: ActiveValue::Set(metadata_id.to_owned()),
        };
        intermediate.insert(&ss.db).await.ok();
    }

    for data in suggestions {
        let db_partial_metadata = commit_metadata(data, ss).await?;
        let intermediate = metadata_to_metadata::ActiveModel {
            to_metadata_id: ActiveValue::Set(db_partial_metadata.id.clone()),
            from_metadata_id: ActiveValue::Set(metadata_id.to_owned()),
            relation: ActiveValue::Set(MetadataToMetadataRelation::Suggestion),
            ..Default::default()
        };
        intermediate.insert(&ss.db).await.ok();
    }

    for metadata_group in groups {
        let db_group = commit_metadata_group(metadata_group, ss).await?;
        let intermediate = metadata_to_metadata_group::ActiveModel {
            part: ActiveValue::Set(0),
            metadata_group_id: ActiveValue::Set(db_group.id),
            metadata_id: ActiveValue::Set(metadata_id.to_owned()),
        };
        intermediate.insert(&ss.db).await.ok();
    }

    Ok(())
}

pub async fn update_metadata(
    metadata_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<UpdateMediaEntityResult> {
    let metadata = Metadata::find_by_id(metadata_id)
        .one(&ss.db)
        .await
        .unwrap()
        .unwrap();
    if !metadata.is_partial.unwrap_or_default() {
        return Ok(UpdateMediaEntityResult::default());
    }
    let mut result = UpdateMediaEntityResult::default();
    ryot_log!(debug, "Updating metadata for {:?}", metadata_id);
    Metadata::update_many()
        .filter(metadata::Column::Id.eq(metadata_id))
        .col_expr(metadata::Column::IsPartial, Expr::value(false))
        .exec(&ss.db)
        .await?;
    let maybe_details =
        details_from_provider(metadata.lot, metadata.source, &metadata.identifier, ss).await;
    match maybe_details {
        Ok(details) => {
            let mut notifications = vec![];
            let meta = Metadata::find_by_id(metadata_id)
                .one(&ss.db)
                .await
                .unwrap()
                .unwrap();

            if let (Some(p1), Some(p2)) = (&meta.production_status, &details.production_status) {
                if p1 != p2 {
                    notifications.push((
                        format!("Status changed from {:#?} to {:#?}", p1, p2),
                        UserNotificationContent::MetadataStatusChanged,
                    ));
                }
            }
            if let (Some(p1), Some(p2)) = (meta.publish_year, details.publish_year) {
                if p1 != p2 {
                    notifications.push((
                        format!("Publish year from {:#?} to {:#?}", p1, p2),
                        UserNotificationContent::MetadataReleaseDateChanged,
                    ));
                }
            }
            if let (Some(s1), Some(s2)) = (&meta.show_specifics, &details.show_specifics) {
                if s1.seasons.len() != s2.seasons.len() {
                    notifications.push((
                        format!(
                            "Number of seasons changed from {:#?} to {:#?}",
                            s1.seasons.len(),
                            s2.seasons.len()
                        ),
                        UserNotificationContent::MetadataNumberOfSeasonsChanged,
                    ));
                } else {
                    for (s1, s2) in zip(s1.seasons.iter(), s2.seasons.iter()) {
                        if SHOW_SPECIAL_SEASON_NAMES.contains(&s1.name.as_str())
                            && SHOW_SPECIAL_SEASON_NAMES.contains(&s2.name.as_str())
                        {
                            continue;
                        }
                        if s1.episodes.len() != s2.episodes.len() {
                            notifications.push((
                                format!(
                                    "Number of episodes changed from {:#?} to {:#?} (Season {})",
                                    s1.episodes.len(),
                                    s2.episodes.len(),
                                    s1.season_number
                                ),
                                UserNotificationContent::MetadataEpisodeReleased,
                            ));
                        } else {
                            for (before_episode, after_episode) in
                                zip(s1.episodes.iter(), s2.episodes.iter())
                            {
                                if before_episode.name != after_episode.name {
                                    notifications.push((
                                        format!(
                                            "Episode name changed from {:#?} to {:#?} (S{}E{})",
                                            before_episode.name,
                                            after_episode.name,
                                            s1.season_number,
                                            before_episode.episode_number
                                        ),
                                        UserNotificationContent::MetadataEpisodeNameChanged,
                                    ));
                                }
                                if before_episode.poster_images != after_episode.poster_images {
                                    notifications.push((
                                        format!(
                                            "Episode image changed for S{}E{}",
                                            s1.season_number, before_episode.episode_number
                                        ),
                                        UserNotificationContent::MetadataEpisodeImagesChanged,
                                    ));
                                }
                                if let (Some(pd1), Some(pd2)) =
                                    (before_episode.publish_date, after_episode.publish_date)
                                {
                                    if pd1 != pd2 {
                                        notifications.push((
                                            format!(
                                                "Episode release date changed from {:?} to {:?} (S{}E{})",
                                                pd1,
                                                pd2,
                                                s1.season_number,
                                                before_episode.episode_number
                                            ),
                                            UserNotificationContent::MetadataReleaseDateChanged,
                                        ));
                                    }
                                }
                            }
                        }
                    }
                }
            };
            if let (Some(a1), Some(a2)) = (&meta.anime_specifics, &details.anime_specifics) {
                if let (Some(e1), Some(e2)) = (a1.episodes, a2.episodes) {
                    if e1 != e2 {
                        notifications.push((
                            format!("Number of episodes changed from {:#?} to {:#?}", e1, e2),
                            UserNotificationContent::MetadataChaptersOrEpisodesChanged,
                        ));
                    }
                }
            };
            if let (Some(m1), Some(m2)) = (&meta.manga_specifics, &details.manga_specifics) {
                if let (Some(c1), Some(c2)) = (m1.chapters, m2.chapters) {
                    if c1 != c2 {
                        notifications.push((
                            format!("Number of chapters changed from {:#?} to {:#?}", c1, c2),
                            UserNotificationContent::MetadataChaptersOrEpisodesChanged,
                        ));
                    }
                }
            };
            if let (Some(p1), Some(p2)) = (&meta.podcast_specifics, &details.podcast_specifics) {
                if p1.episodes.len() != p2.episodes.len() {
                    notifications.push((
                        format!(
                            "Number of episodes changed from {:#?} to {:#?}",
                            p1.episodes.len(),
                            p2.episodes.len()
                        ),
                        UserNotificationContent::MetadataEpisodeReleased,
                    ));
                } else {
                    for (before_episode, after_episode) in
                        zip(p1.episodes.iter(), p2.episodes.iter())
                    {
                        if before_episode.title != after_episode.title {
                            notifications.push((
                                format!(
                                    "Episode name changed from {:#?} to {:#?} (EP{})",
                                    before_episode.title,
                                    after_episode.title,
                                    before_episode.number
                                ),
                                UserNotificationContent::MetadataEpisodeNameChanged,
                            ));
                        }
                        if before_episode.thumbnail != after_episode.thumbnail {
                            notifications.push((
                                format!("Episode image changed for EP{}", before_episode.number),
                                UserNotificationContent::MetadataEpisodeImagesChanged,
                            ));
                        }
                    }
                }
            };

            let notifications = notifications
                .into_iter()
                .map(|n| (format!("{} for {:?}.", n.0, meta.title), n.1))
                .collect_vec();

            let free_creators = details
                .creators
                .is_empty()
                .then_some(())
                .map(|_| details.creators);
            let watch_providers = details
                .watch_providers
                .is_empty()
                .then_some(())
                .map(|_| details.watch_providers);

            let mut meta: metadata::ActiveModel = meta.into();
            meta.title = ActiveValue::Set(details.title);
            meta.assets = ActiveValue::Set(details.assets);
            meta.is_partial = ActiveValue::Set(Some(false));
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
    Ok(result)
}

pub async fn update_metadata_group(
    metadata_group_id: &str,
    ss: &Arc<SupportingService>,
) -> Result<UpdateMediaEntityResult> {
    let metadata_group = MetadataGroup::find_by_id(metadata_group_id)
        .one(&ss.db)
        .await?
        .ok_or(Error::new("Group not found"))?;
    if !metadata_group.is_partial.unwrap_or_default() {
        return Ok(UpdateMediaEntityResult::default());
    }
    let provider =
        crate::get_metadata_provider(metadata_group.lot, metadata_group.source, ss).await?;
    let (group_details, associated_items) = provider
        .metadata_group_details(&metadata_group.identifier)
        .await?;
    let mut eg: metadata_group::ActiveModel = metadata_group.into();
    eg.is_partial = ActiveValue::Set(None);
    eg.title = ActiveValue::Set(group_details.title);
    eg.parts = ActiveValue::Set(group_details.parts);
    eg.source_url = ActiveValue::Set(group_details.source_url);
    eg.description = ActiveValue::Set(group_details.description);
    eg.assets = ActiveValue::Set(group_details.assets);
    let eg = eg.update(&ss.db).await?;
    for (idx, media) in associated_items.into_iter().enumerate() {
        let db_partial_metadata = commit_metadata(media, ss).await?;
        MetadataToMetadataGroup::delete_many()
            .filter(metadata_to_metadata_group::Column::MetadataGroupId.eq(&eg.id))
            .filter(metadata_to_metadata_group::Column::MetadataId.eq(&db_partial_metadata.id))
            .exec(&ss.db)
            .await
            .ok();
        let intermediate = metadata_to_metadata_group::ActiveModel {
            metadata_group_id: ActiveValue::Set(eg.id.clone()),
            metadata_id: ActiveValue::Set(db_partial_metadata.id),
            part: ActiveValue::Set((idx + 1).try_into().unwrap()),
        };
        intermediate.insert(&ss.db).await.ok();
    }
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
    let provider_person = provider
        .person_details(&person.identifier, &person.source_specifics)
        .await?;
    ryot_log!(debug, "Updating person for {:?}", person_id);

    let mut current_state_changes = person.clone().state_changes.unwrap_or_default();
    let mut to_update_person: person::ActiveModel = person.clone().into();
    to_update_person.is_partial = ActiveValue::Set(Some(false));
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
        let pm = commit_metadata(data.metadata, ss).await?;
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
            notifications.push((
                format!(
                    "{} has been associated with {} as {}",
                    person.name, title, data.role
                ),
                UserNotificationContent::PersonMetadataAssociated,
            ));
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
            notifications.push((
                format!(
                    "{} has been associated with {} as {}",
                    person.name, data.metadata_group.title, data.role
                ),
                UserNotificationContent::PersonMetadataGroupAssociated,
            ));
            current_state_changes
                .metadata_groups_associated
                .insert(search_for);
        }
    }
    to_update_person.state_changes = ActiveValue::Set(Some(current_state_changes));
    to_update_person.update(&ss.db).await.unwrap();
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
        .filter(match data.source_specifics.clone() {
            None => person::Column::SourceSpecifics.is_null(),
            Some(specifics) => person::Column::SourceSpecifics.eq(specifics),
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
            let person = person::ActiveModel {
                assets: ActiveValue::Set(assets),
                name: ActiveValue::Set(data.name),
                source: ActiveValue::Set(data.source),
                is_partial: ActiveValue::Set(Some(true)),
                identifier: ActiveValue::Set(data.identifier),
                source_specifics: ActiveValue::Set(data.source_specifics),
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
) -> Result<MetadataBaseData> {
    let Some(mut meta) = Metadata::find_by_id(metadata_id).one(&ss.db).await.unwrap() else {
        return Err(Error::new("The record does not exist".to_owned()));
    };
    let genres = meta
        .find_related(Genre)
        .order_by_asc(genre::Column::Name)
        .into_model::<GenreListItem>()
        .all(&ss.db)
        .await
        .unwrap();
    #[derive(Debug, FromQueryResult)]
    struct PartialCreator {
        id: String,
        name: String,
        role: String,
        assets: EntityAssets,
        character: Option<String>,
    }
    let crts = MetadataToPerson::find()
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
        .await?;
    let mut creators: HashMap<String, Vec<_>> = HashMap::new();
    for cr in crts {
        let creator = MetadataCreator {
            name: cr.name,
            id: Some(cr.id),
            character: cr.character,
            image: cr.assets.remote_images.first().cloned(),
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
                name: cr.name,
                image: cr.image,
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
        .map(|(name, items)| MetadataCreatorGroupedByRole { name, items })
        .collect_vec();
    let suggestions = MetadataToMetadata::find()
        .select_only()
        .column(metadata_to_metadata::Column::ToMetadataId)
        .filter(metadata_to_metadata::Column::FromMetadataId.eq(&meta.id))
        .filter(metadata_to_metadata::Column::Relation.eq(MetadataToMetadataRelation::Suggestion))
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    transform_entity_assets(&mut meta.assets, ss).await?;
    Ok(MetadataBaseData {
        genres,
        creators,
        model: meta,
        suggestions,
    })
}
