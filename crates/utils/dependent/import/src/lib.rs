use std::{
    collections::{HashMap, hash_map::Entry},
    future::Future,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

use anyhow::Result;
use chrono::{Duration, NaiveDateTime, Offset, TimeZone, Utc};
use common_models::{ChangeCollectionToEntitiesInput, EntityToCollectionInput, EntityWithLot};
use common_utils::ryot_log;
use database_models::{exercise, prelude::Exercise};
use database_utils::{schedule_user_for_workout_revision, user_by_id};
use dependent_collection_utils::{add_entities_to_collection, create_or_update_collection};
use dependent_entity_utils::{commit_metadata, commit_metadata_group, commit_person};
use dependent_fitness_utils::{
    create_custom_exercise, create_or_update_user_measurement, create_or_update_user_workout,
    db_workout_to_workout_input, generate_exercise_id,
};
use dependent_jobs_utils::deploy_update_media_entity_job;
use dependent_models::{ImportCompletedItem, ImportOrExportMetadataItem, ImportResult};
use dependent_progress_utils::commit_import_seen_item;
use dependent_review_utils::{convert_review_into_input, create_or_update_review};
use enum_models::{EntityLot, ExerciseLot, ExerciseSource, MediaLot, MediaSource};
use importer_models::{ImportDetails, ImportFailStep, ImportFailedItem, ImportResultResponse};
use media_models::{
    CommitMetadataGroupInput, CommitPersonInput, CreateOrUpdateCollectionInput,
    PartialMetadataWithoutId, UniqueMediaIdentifier,
};
use rand::seq::SliceRandom;
use rust_decimal::{Decimal, dec, prelude::FromPrimitive};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, prelude::DateTimeUtc};
use supporting_service::SupportingService;
use uuid::Uuid;

// TEMP(1611): debug instrumentation for duplicate seen records; remove after investigation completes
static SEEN_PROCESSING_COUNTER: AtomicU64 = AtomicU64::new(0);

async fn create_collection_and_add_entity_to_it(
    user_id: &String,
    entity_id: String,
    entity_lot: EntityLot,
    collection_name: String,
    ss: &Arc<SupportingService>,
    information: Option<serde_json::Value>,
    import_failed_set: &mut Vec<ImportFailedItem>,
) {
    if let Err(e) = create_or_update_collection(
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
            error: Some(e.to_string()),
            identifier: collection_name.clone(),
            step: ImportFailStep::DatabaseCommit,
            ..Default::default()
        });
        return;
    }
    if let Err(e) = add_entities_to_collection(
        user_id,
        ChangeCollectionToEntitiesInput {
            collection_name: collection_name.clone(),
            entities: vec![EntityToCollectionInput {
                entity_id: entity_id.clone(),
                entity_lot,
                information,
            }],
            ..Default::default()
        },
        ss,
    )
    .await
    {
        import_failed_set.push(ImportFailedItem {
            identifier: entity_id,
            error: Some(e.to_string()),
            step: ImportFailStep::DatabaseCommit,
            ..Default::default()
        });
    }
}

pub async fn process_import<F>(
    is_import: bool,
    user_id: &String,
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
    let mut other_items = vec![];

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
                        let existing_seen_count = existing_metadata.seen_history.len();
                        existing_metadata
                            .seen_history
                            .append(&mut current_metadata.seen_history);
                        ryot_log!(
                            debug,
                            "Aggregating duplicate metadata ({}): merged seen_history from {} to {} items",
                            current_metadata.identifier,
                            existing_seen_count,
                            existing_metadata.seen_history.len()
                        );
                        existing_metadata
                            .reviews
                            .append(&mut current_metadata.reviews);
                        existing_metadata
                            .collections
                            .append(&mut current_metadata.collections);
                    }
                    Entry::Vacant(entry) => {
                        ryot_log!(
                            debug,
                            "Adding new metadata ({}) with {} seen_history items",
                            entry.key().1,
                            current_metadata.seen_history.len()
                        );
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
        ImportCompletedItem::Person(p) => !p.reviews.is_empty() || !p.collections.is_empty(),
        ImportCompletedItem::MetadataGroup(m) => !m.reviews.is_empty() || !m.collections.is_empty(),
        ImportCompletedItem::Metadata(m) => {
            !m.seen_history.is_empty() || !m.reviews.is_empty() || !m.collections.is_empty()
        }
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
        ryot_log!(debug, "Processing item ({:#}) {}/{}", item, idx + 1, total,);
        match item {
            ImportCompletedItem::Empty => {}
            ImportCompletedItem::Metadata(metadata) => {
                let execution_id = Uuid::new_v4();
                let metadata_ptr = format!("{:p}", &metadata as *const _);
                ryot_log!(
                    debug,
                    "[1611 TRACE {}] Starting metadata processing, ptr={}",
                    execution_id,
                    metadata_ptr
                );
                let (db_metadata_id, was_updated_successfully) = match commit_metadata(
                    PartialMetadataWithoutId {
                        lot: metadata.lot,
                        source: metadata.source,
                        title: metadata.source_id.clone(),
                        identifier: metadata.identifier.clone(),
                        ..Default::default()
                    },
                    ss,
                    Some(true),
                )
                .await
                {
                    Ok((metadata, success)) => (metadata.id, success),
                    Err(e) => {
                        import.failed.push(ImportFailedItem {
                            lot: Some(metadata.lot),
                            error: Some(e.to_string()),
                            step: ImportFailStep::DatabaseCommit,
                            identifier: metadata.source_id.to_string(),
                        });
                        continue;
                    }
                };
                if !was_updated_successfully {
                    import.failed.push(ImportFailedItem {
                        lot: Some(metadata.lot),
                        identifier: db_metadata_id.clone(),
                        step: ImportFailStep::MediaDetailsFromProvider,
                        error: Some("Progress update *might* be wrong".to_owned()),
                    });
                }
                let counter_value = SEEN_PROCESSING_COUNTER.fetch_add(1, Ordering::SeqCst);
                ryot_log!(
                    debug,
                    "[1611 TRACE {}] [1611 COUNTER {}] Before seen_history processing, metadata.seen_history.len={}, ptr={}",
                    execution_id,
                    counter_value,
                    metadata.seen_history.len(),
                    metadata_ptr
                );
                ryot_log!(
                    debug,
                    "Processing {} seen_history items for metadata: {}",
                    metadata.seen_history.len(),
                    db_metadata_id
                );
                let seen_history_len = metadata.seen_history.len();
                ryot_log!(
                    debug,
                    "[1611 TRACE {}] After seen_history log, about to enter loop with {} items",
                    execution_id,
                    seen_history_len
                );
                for (seen_idx, seen) in metadata.seen_history.into_iter().enumerate() {
                    ryot_log!(
                        debug,
                        "[1611 TRACE {}] Processing seen item {}/{} for metadata: {}",
                        execution_id,
                        seen_idx + 1,
                        seen_history_len,
                        db_metadata_id
                    );
                    if let Err(e) =
                        commit_import_seen_item(is_import, user_id, &db_metadata_id, ss, seen).await
                    {
                        ryot_log!(debug, "Failed to commit seen item: {}", e);
                        import.failed.push(ImportFailedItem {
                            lot: Some(metadata.lot),
                            error: Some(e.to_string()),
                            step: ImportFailStep::DatabaseCommit,
                            identifier: metadata.source_id.to_owned(),
                        });
                    };
                }
                ryot_log!(
                    debug,
                    "[1611 TRACE {}] Completed seen_history processing for metadata: {}",
                    execution_id,
                    db_metadata_id
                );
                for review in metadata.reviews.iter() {
                    if let Some(input) = convert_review_into_input(
                        review,
                        &preferences,
                        db_metadata_id.clone(),
                        EntityLot::Metadata,
                    ) && let Err(e) = create_or_update_review(user_id, input, ss).await
                    {
                        import.failed.push(ImportFailedItem {
                            lot: Some(metadata.lot),
                            error: Some(e.to_string()),
                            step: ImportFailStep::DatabaseCommit,
                            identifier: metadata.source_id.to_owned(),
                        });
                    };
                }
                for col in metadata.collections.into_iter() {
                    create_collection_and_add_entity_to_it(
                        user_id,
                        db_metadata_id.clone(),
                        EntityLot::Metadata,
                        col.collection_name,
                        ss,
                        col.information,
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
                            error: Some(e.to_string()),
                            lot: Some(metadata_group.lot),
                            step: ImportFailStep::DatabaseCommit,
                            identifier: metadata_group.title.to_string(),
                        });
                        continue;
                    }
                };
                deploy_update_media_entity_job(
                    EntityWithLot {
                        entity_id: db_metadata_group_id.clone(),
                        entity_lot: EntityLot::MetadataGroup,
                    },
                    ss,
                )
                .await?;
                for review in metadata_group.reviews.iter() {
                    if let Some(input) = convert_review_into_input(
                        review,
                        &preferences,
                        db_metadata_group_id.clone(),
                        EntityLot::MetadataGroup,
                    ) && let Err(e) = create_or_update_review(user_id, input, ss).await
                    {
                        import.failed.push(ImportFailedItem {
                            error: Some(e.to_string()),
                            lot: Some(metadata_group.lot),
                            step: ImportFailStep::DatabaseCommit,
                            identifier: metadata_group.title.to_owned(),
                        });
                    };
                }
                for col in metadata_group.collections.into_iter() {
                    create_collection_and_add_entity_to_it(
                        user_id,
                        db_metadata_group_id.clone(),
                        EntityLot::MetadataGroup,
                        col.collection_name,
                        ss,
                        col.information,
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
                            error: Some(e.to_string()),
                            identifier: person.name.to_string(),
                            step: ImportFailStep::DatabaseCommit,
                            ..Default::default()
                        });
                        continue;
                    }
                };
                deploy_update_media_entity_job(
                    EntityWithLot {
                        entity_id: db_person_id.clone(),
                        entity_lot: EntityLot::Person,
                    },
                    ss,
                )
                .await?;
                for review in person.reviews.iter() {
                    if let Some(input) = convert_review_into_input(
                        review,
                        &preferences,
                        db_person_id.clone(),
                        EntityLot::Person,
                    ) && let Err(e) = create_or_update_review(user_id, input, ss).await
                    {
                        import.failed.push(ImportFailedItem {
                            error: Some(e.to_string()),
                            identifier: person.name.to_owned(),
                            step: ImportFailStep::DatabaseCommit,
                            ..Default::default()
                        });
                    };
                }
                for col in person.collections.into_iter() {
                    create_collection_and_add_entity_to_it(
                        user_id,
                        db_person_id.clone(),
                        EntityLot::Person,
                        col.collection_name,
                        ss,
                        col.information,
                        &mut import.failed,
                    )
                    .await;
                }
            }
            ImportCompletedItem::Collection(col_details) => {
                if let Err(e) = create_or_update_collection(user_id, ss, col_details.clone()).await
                {
                    import.failed.push(ImportFailedItem {
                        error: Some(e.to_string()),
                        identifier: col_details.name.clone(),
                        step: ImportFailStep::DatabaseCommit,
                        ..Default::default()
                    });
                }
            }
            ImportCompletedItem::Exercise(exercise) => {
                if let Err(e) = create_custom_exercise(user_id, exercise.clone(), ss).await {
                    import.failed.push(ImportFailedItem {
                        error: Some(e.to_string()),
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
                        identifier: workout.name,
                        error: Some(err.to_string()),
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
                            error: Some(err.to_string()),
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
                                col.collection_name,
                                ss,
                                col.information,
                                &mut import.failed,
                            )
                            .await;
                        }
                    }
                }
            }
            ImportCompletedItem::Measurement(measurement) => {
                if let Err(err) =
                    create_or_update_user_measurement(user_id, measurement.clone(), ss).await
                {
                    import.failed.push(ImportFailedItem {
                        error: Some(err.to_string()),
                        step: ImportFailStep::DatabaseCommit,
                        identifier: measurement.timestamp.to_string(),
                        ..Default::default()
                    });
                }
            }
        }

        if idx % 10 == 0 || idx + 1 == total {
            on_item_processed(
                Decimal::from_usize(idx + 1).unwrap() / Decimal::from_usize(total).unwrap()
                    * dec!(100),
            )
            .await?;
        }
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

pub fn get_date_time_with_offset(
    date_time: NaiveDateTime,
    timezone: &chrono_tz::Tz,
) -> DateTimeUtc {
    let offset = timezone
        .offset_from_utc_datetime(&Utc::now().naive_utc())
        .fix()
        .local_minus_utc();
    let offset = Duration::try_seconds(offset.into()).unwrap();
    DateTimeUtc::from_naive_utc_and_offset(date_time, Utc) - offset
}

pub async fn associate_with_existing_or_new_exercise(
    user_id: &str,
    exercise_name: &String,
    exercise_lot: ExerciseLot,
    ss: &Arc<SupportingService>,
    unique_exercises: &mut HashMap<String, exercise::Model>,
) -> Result<String> {
    let existing_exercise = Exercise::find()
        .filter(exercise::Column::Lot.eq(exercise_lot))
        .filter(exercise::Column::Name.eq(exercise_name))
        .one(&ss.db)
        .await?;
    let generated_id = generate_exercise_id(exercise_name, exercise_lot, user_id);
    let exercise_id = match existing_exercise {
        Some(db_ex) if db_ex.source == ExerciseSource::Github || db_ex.id == generated_id => {
            db_ex.id
        }
        _ => match unique_exercises.get(exercise_name) {
            Some(mem_ex) => mem_ex.id.clone(),
            None => {
                unique_exercises.insert(
                    exercise_name.clone(),
                    exercise::Model {
                        lot: exercise_lot,
                        id: generated_id.clone(),
                        name: exercise_name.to_owned(),
                        ..Default::default()
                    },
                );
                generated_id
            }
        },
    };
    Ok(exercise_id)
}
