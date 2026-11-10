use super::*;

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
        .await?
        .ok_or_else(|| anyhow!("Metadata {} not found", metadata_id))?;
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
            let metadata = meta.update(&ss.db).await?;

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
            return Err(e);
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
            .await?;
        let intermediate = metadata_to_metadata_group::ActiveModel {
            metadata_group_id: ActiveValue::Set(eg.id.clone()),
            metadata_id: ActiveValue::Set(db_partial_metadata.id),
            part: ActiveValue::Set(Some((idx + 1).try_into().unwrap())),
        };
        intermediate.insert(&ss.db).await?;
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
        .ok_or_else(|| anyhow!("Person {} not found", person_id))?;
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
            intermediate.insert(&ss.db).await?;
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
    to_update_person.update(&ss.db).await?;
    expire_person_details_cache(&person_id, ss).await?;
    Ok(UpdateMediaEntityResult { notifications })
}
