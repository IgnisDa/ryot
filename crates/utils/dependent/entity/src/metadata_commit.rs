use super::*;

pub(super) async fn ensure_metadata_updated(
    metadata_id: &String,
    ss: &Arc<SupportingService>,
    ensure_updated: Option<bool>,
) -> Result<bool> {
    if ensure_updated == Some(true) {
        let result = Box::pin(update_metadata(metadata_id, ss)).await?;
        if !result.notifications.is_empty() {
            ss.perform_application_job(ApplicationJob::Mp(
                background_models::MpApplicationJob::NotifyMetadataUpdated(
                    metadata_id.clone(),
                    result.notifications,
                ),
            ))
            .await?;
        }
    }
    Ok(true)
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
        .await?
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
        (true, Some(true)) => Metadata::find_by_id(&mode.id)
            .one(&ss.db)
            .await?
            .ok_or_else(|| anyhow!("Metadata {} not found after ensure_updated", mode.id))?,
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

    MetadataToMetadata::delete_many()
        .filter(metadata_to_metadata::Column::FromMetadataId.eq(metadata_id))
        .filter(metadata_to_metadata::Column::Relation.eq(MetadataToMetadataRelation::Suggestion))
        .exec(&ss.db)
        .await?;
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
