use std::{collections::HashMap, future::Future, sync::Arc};

use async_graphql::Result;
use common_models::ChangeCollectionToEntityInput;
use common_utils::{MAX_IMPORT_RETRIES_FOR_PARTIAL_STATE, ryot_log, sleep_for_n_seconds};
use database_models::{metadata, prelude::Metadata};
use database_utils::{schedule_user_for_workout_revision, user_by_id};
use dependent_models::{ImportCompletedItem, ImportResult};
use enum_models::{EntityLot, MediaLot, MediaSource};
use importer_models::ImportFailedItem;
use importer_models::{ImportDetails, ImportFailStep, ImportResultResponse};
use media_models::{
    CommitMetadataGroupInput, CommitPersonInput, CreateOrUpdateCollectionInput,
    ImportOrExportMetadataItem, PartialMetadataWithoutId, ProgressUpdateInput,
    UniqueMediaIdentifier,
};
use rand::seq::SliceRandom;
use rust_decimal::{Decimal, prelude::FromPrimitive};
use rust_decimal_macros::dec;
use sea_orm::{EntityTrait, QuerySelect};
use std::collections::hash_map::Entry;
use supporting_service::SupportingService;

use crate::{
    collection_operations, commit_metadata, commit_metadata_group, commit_person,
    convert_review_into_input, create_custom_exercise, create_or_update_user_workout,
    create_user_measurement, db_workout_to_workout_input, deploy_update_metadata_group_job,
    deploy_update_metadata_job, deploy_update_person_job, post_review, progress_update,
};

async fn create_collection_and_add_entity_to_it(
    user_id: &String,
    entity_id: String,
    entity_lot: EntityLot,
    collection_name: String,
    ss: &Arc<SupportingService>,
    import_failed_set: &mut Vec<ImportFailedItem>,
) {
    if let Err(e) = collection_operations::create_or_update_collection(
        user_id,
        ss,
        CreateOrUpdateCollectionInput {
            name: collection_name.clone(),
            ..Default::default()
        },
    )
    .await
    {
        import_failed_set.push(ImportFailedItem {
            error: Some(e.message),
            identifier: collection_name.clone(),
            step: ImportFailStep::DatabaseCommit,
            ..Default::default()
        });
        return;
    }
    if let Err(e) = collection_operations::add_entity_to_collection(
        user_id,
        ChangeCollectionToEntityInput {
            collection_name: collection_name.clone(),
            entity_id: entity_id.clone(),
            entity_lot,
            ..Default::default()
        },
        ss,
    )
    .await
    {
        import_failed_set.push(ImportFailedItem {
            error: Some(e.message),
            identifier: entity_id,
            step: ImportFailStep::DatabaseCommit,
            ..Default::default()
        });
    }
}

pub async fn process_import<F>(
    user_id: &String,
    respect_cache: bool,
    mut import: ImportResult,
    ss: &Arc<SupportingService>,
    on_item_processed: impl Fn(Decimal) -> F,
) -> Result<(ImportResult, ImportResultResponse)>
where
    F: Future<Output = Result<()>>,
{
    let preferences = user_by_id(user_id, ss).await?.preferences;

    let mut aggregated_metadata: HashMap<
        (MediaSource, String, MediaLot),
        ImportOrExportMetadataItem,
    > = HashMap::new();
    let mut other_items = Vec::new();

    for item in import.completed {
        match item {
            ImportCompletedItem::Metadata(mut current_metadata) => {
                let key = (
                    current_metadata.source,
                    current_metadata.identifier.clone(),
                    current_metadata.lot,
                );
                match aggregated_metadata.entry(key) {
                    Entry::Occupied(mut entry) => {
                        let existing_metadata = entry.get_mut();
                        existing_metadata
                            .seen_history
                            .append(&mut current_metadata.seen_history);
                        existing_metadata
                            .reviews
                            .append(&mut current_metadata.reviews);
                        existing_metadata
                            .collections
                            .append(&mut current_metadata.collections);
                    }
                    Entry::Vacant(entry) => {
                        entry.insert(current_metadata);
                    }
                }
            }
            other => {
                other_items.push(other);
            }
        }
    }

    import.completed = aggregated_metadata
        .into_values()
        .map(ImportCompletedItem::Metadata)
        .chain(other_items.into_iter())
        .collect();

    import.completed.retain(|i| match i {
        ImportCompletedItem::Metadata(m) => {
            !m.seen_history.is_empty() || !m.reviews.is_empty() || !m.collections.is_empty()
        }
        ImportCompletedItem::Person(p) => !p.reviews.is_empty() || !p.collections.is_empty(),
        ImportCompletedItem::MetadataGroup(m) => !m.reviews.is_empty() || !m.collections.is_empty(),
        _ => true,
    });

    import.completed.shuffle(&mut rand::rng());

    // DEV: We need to make sure that exercises are created first because workouts are
    // dependent on them.
    import.completed.sort_by_key(|i| match i {
        ImportCompletedItem::Exercise(_) => 0,
        _ => 1,
    });

    let source_result = import.clone();
    let total = import.completed.len();

    let mut need_to_schedule_user_for_workout_revision = false;

    for (idx, item) in import.completed.into_iter().enumerate() {
        ryot_log!(
            debug,
            "Processing item ({}) {}/{}",
            item.to_string(),
            idx + 1,
            total,
        );
        match item {
            ImportCompletedItem::Empty => {}
            ImportCompletedItem::Metadata(metadata) => {
                let db_metadata_id = match commit_metadata(
                    PartialMetadataWithoutId {
                        lot: metadata.lot,
                        source: metadata.source,
                        title: metadata.source_id.clone(),
                        identifier: metadata.identifier.clone(),
                        ..Default::default()
                    },
                    ss,
                )
                .await
                {
                    Ok(m) => m.id,
                    Err(e) => {
                        import.failed.push(ImportFailedItem {
                            error: Some(e.message),
                            lot: Some(metadata.lot),
                            step: ImportFailStep::DatabaseCommit,
                            identifier: metadata.source_id.to_string(),
                        });
                        continue;
                    }
                };
                let mut was_updated_successfully = false;
                for attempt in 0..MAX_IMPORT_RETRIES_FOR_PARTIAL_STATE {
                    let is_partial = Metadata::find_by_id(&db_metadata_id)
                        .select_only()
                        .column(metadata::Column::IsPartial)
                        .into_tuple::<bool>()
                        .one(&ss.db)
                        .await?
                        .unwrap_or(true);
                    if is_partial {
                        deploy_update_metadata_job(&db_metadata_id, ss).await?;
                        let sleep_time = u64::pow(2, (attempt + 1).try_into().unwrap());
                        ryot_log!(debug, "Sleeping for {}s before metadata check", sleep_time);
                        sleep_for_n_seconds(sleep_time).await;
                    } else {
                        was_updated_successfully = true;
                        break;
                    }
                }
                if !was_updated_successfully {
                    import.failed.push(ImportFailedItem {
                        lot: Some(metadata.lot),
                        identifier: db_metadata_id.clone(),
                        step: ImportFailStep::MediaDetailsFromProvider,
                        error: Some("Progress update *might* be wrong".to_owned()),
                    });
                }
                for seen in metadata.seen_history.iter() {
                    let progress = match seen.progress {
                        Some(_p) => seen.progress,
                        None => Some(dec!(100)),
                    };
                    if let Err(e) = progress_update(
                        user_id,
                        respect_cache,
                        ProgressUpdateInput {
                            progress,
                            date: seen.ended_on,
                            start_date: seen.started_on,
                            metadata_id: db_metadata_id.clone(),
                            show_season_number: seen.show_season_number,
                            show_episode_number: seen.show_episode_number,
                            manga_volume_number: seen.manga_volume_number,
                            anime_episode_number: seen.anime_episode_number,
                            manga_chapter_number: seen.manga_chapter_number,
                            podcast_episode_number: seen.podcast_episode_number,
                            provider_watched_on: seen.provider_watched_on.clone(),
                            ..Default::default()
                        },
                        ss,
                    )
                    .await
                    {
                        import.failed.push(ImportFailedItem {
                            lot: Some(metadata.lot),
                            step: ImportFailStep::DatabaseCommit,
                            identifier: metadata.source_id.to_owned(),
                            error: Some(e.message),
                        });
                    };
                }
                for review in metadata.reviews.iter() {
                    if let Some(input) = convert_review_into_input(
                        review,
                        &preferences,
                        db_metadata_id.clone(),
                        EntityLot::Metadata,
                    ) {
                        if let Err(e) = post_review(user_id, input, ss).await {
                            import.failed.push(ImportFailedItem {
                                lot: Some(metadata.lot),
                                step: ImportFailStep::DatabaseCommit,
                                identifier: metadata.source_id.to_owned(),
                                error: Some(e.message),
                            });
                        };
                    }
                }
                for col in metadata.collections.into_iter() {
                    create_collection_and_add_entity_to_it(
                        user_id,
                        db_metadata_id.clone(),
                        EntityLot::Metadata,
                        col,
                        ss,
                        &mut import.failed,
                    )
                    .await;
                }
            }
            ImportCompletedItem::MetadataGroup(metadata_group) => {
                let db_metadata_group_id = match commit_metadata_group(
                    CommitMetadataGroupInput {
                        name: metadata_group.title.clone(),
                        unique: UniqueMediaIdentifier {
                            lot: metadata_group.lot,
                            source: metadata_group.source,
                            identifier: metadata_group.identifier.clone(),
                        },
                        ..Default::default()
                    },
                    ss,
                )
                .await
                {
                    Ok(m) => m.id,
                    Err(e) => {
                        import.failed.push(ImportFailedItem {
                            error: Some(e.message),
                            lot: Some(metadata_group.lot),
                            step: ImportFailStep::DatabaseCommit,
                            identifier: metadata_group.title.to_string(),
                        });
                        continue;
                    }
                };
                deploy_update_metadata_group_job(&db_metadata_group_id, ss).await?;
                for review in metadata_group.reviews.iter() {
                    if let Some(input) = convert_review_into_input(
                        review,
                        &preferences,
                        db_metadata_group_id.clone(),
                        EntityLot::MetadataGroup,
                    ) {
                        if let Err(e) = post_review(user_id, input, ss).await {
                            import.failed.push(ImportFailedItem {
                                lot: Some(metadata_group.lot),
                                step: ImportFailStep::DatabaseCommit,
                                identifier: metadata_group.title.to_owned(),
                                error: Some(e.message),
                            });
                        };
                    }
                }
                for col in metadata_group.collections.into_iter() {
                    create_collection_and_add_entity_to_it(
                        user_id,
                        db_metadata_group_id.clone(),
                        EntityLot::MetadataGroup,
                        col,
                        ss,
                        &mut import.failed,
                    )
                    .await;
                }
            }
            ImportCompletedItem::Person(person) => {
                let db_person_id = match commit_person(
                    CommitPersonInput {
                        source: person.source,
                        name: person.name.clone(),
                        identifier: person.identifier.clone(),
                        source_specifics: person.source_specifics.clone(),
                        ..Default::default()
                    },
                    ss,
                )
                .await
                {
                    Ok(p) => p.id,
                    Err(e) => {
                        import.failed.push(ImportFailedItem {
                            error: Some(e.message),
                            identifier: person.name.to_string(),
                            step: ImportFailStep::DatabaseCommit,
                            ..Default::default()
                        });
                        continue;
                    }
                };
                deploy_update_person_job(&db_person_id, ss).await?;
                for review in person.reviews.iter() {
                    if let Some(input) = convert_review_into_input(
                        review,
                        &preferences,
                        db_person_id.clone(),
                        EntityLot::Person,
                    ) {
                        if let Err(e) = post_review(user_id, input, ss).await {
                            import.failed.push(ImportFailedItem {
                                error: Some(e.message),
                                identifier: person.name.to_owned(),
                                step: ImportFailStep::DatabaseCommit,
                                ..Default::default()
                            });
                        };
                    }
                }
                for col in person.collections.into_iter() {
                    create_collection_and_add_entity_to_it(
                        user_id,
                        db_person_id.clone(),
                        EntityLot::Person,
                        col,
                        ss,
                        &mut import.failed,
                    )
                    .await;
                }
            }
            ImportCompletedItem::Collection(col_details) => {
                if let Err(e) = collection_operations::create_or_update_collection(
                    user_id,
                    ss,
                    col_details.clone(),
                )
                .await
                {
                    import.failed.push(ImportFailedItem {
                        error: Some(e.message),
                        identifier: col_details.name.clone(),
                        step: ImportFailStep::DatabaseCommit,
                        ..Default::default()
                    });
                }
            }
            ImportCompletedItem::Exercise(exercise) => {
                if let Err(e) = create_custom_exercise(user_id, exercise.clone(), ss).await {
                    import.failed.push(ImportFailedItem {
                        error: Some(e.message),
                        identifier: exercise.name.clone(),
                        step: ImportFailStep::DatabaseCommit,
                        ..Default::default()
                    });
                }
            }
            ImportCompletedItem::Workout(workout) => {
                need_to_schedule_user_for_workout_revision = true;
                if let Err(err) = create_or_update_user_workout(user_id, workout.clone(), ss).await
                {
                    import.failed.push(ImportFailedItem {
                        error: Some(err.message),
                        identifier: workout.name,
                        step: ImportFailStep::DatabaseCommit,
                        ..Default::default()
                    });
                }
            }
            ImportCompletedItem::ApplicationWorkout(workout) => {
                need_to_schedule_user_for_workout_revision = true;
                let workout_input = db_workout_to_workout_input(workout.details);
                match create_or_update_user_workout(user_id, workout_input.clone(), ss).await {
                    Err(err) => {
                        import.failed.push(ImportFailedItem {
                            error: Some(err.message),
                            identifier: workout_input.name,
                            step: ImportFailStep::DatabaseCommit,
                            ..Default::default()
                        });
                    }
                    Ok(workout_id) => {
                        for col in workout.collections.into_iter() {
                            create_collection_and_add_entity_to_it(
                                user_id,
                                workout_id.clone(),
                                EntityLot::Workout,
                                col,
                                ss,
                                &mut import.failed,
                            )
                            .await;
                        }
                    }
                }
            }
            ImportCompletedItem::Measurement(measurement) => {
                if let Err(err) = create_user_measurement(user_id, measurement.clone(), ss).await {
                    import.failed.push(ImportFailedItem {
                        error: Some(err.message),
                        step: ImportFailStep::DatabaseCommit,
                        identifier: measurement.timestamp.to_string(),
                        ..Default::default()
                    });
                }
            }
        }

        on_item_processed(
            Decimal::from_usize(idx + 1).unwrap() / Decimal::from_usize(total).unwrap() * dec!(100),
        )
        .await?;
    }

    if need_to_schedule_user_for_workout_revision {
        schedule_user_for_workout_revision(user_id, ss).await?;
    }

    let details = ImportResultResponse {
        failed_items: import.failed,
        import: ImportDetails { total },
    };

    Ok((source_result, details))
}
