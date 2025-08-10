use std::{collections::HashMap, future::Future, sync::Arc};

use anyhow::Result;
use common_models::{ChangeCollectionToEntitiesInput, EntityToCollectionInput};
use common_utils::ryot_log;
use database_utils::{schedule_user_for_workout_revision, user_by_id};
use dependent_collection_utils::{add_entities_to_collection, create_or_update_collection};
use dependent_fitness_utils::{
    create_custom_exercise, create_or_update_user_workout, create_user_measurement,
    db_workout_to_workout_input,
};
use dependent_jobs_utils::{deploy_update_metadata_group_job, deploy_update_person_job};
use dependent_metadata_utils::{commit_metadata, commit_metadata_group, commit_person};
use dependent_models::{ImportCompletedItem, ImportOrExportMetadataItem, ImportResult};
use dependent_progress_utils::commit_import_seen_item;
use dependent_review_utils::{convert_review_into_input, post_review};
use enum_models::{EntityLot, MediaLot, MediaSource};
use importer_models::ImportFailedItem;
use importer_models::{ImportDetails, ImportFailStep, ImportResultResponse};
use media_models::{
    CommitMetadataGroupInput, CommitPersonInput, CreateOrUpdateCollectionInput,
    PartialMetadataWithoutId, UniqueMediaIdentifier,
};
use rand::seq::SliceRandom;
use rust_decimal::{Decimal, prelude::FromPrimitive};
use rust_decimal_macros::dec;
use std::collections::hash_map::Entry;
use supporting_service::SupportingService;

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
                for seen in metadata.seen_history {
                    if let Err(e) =
                        commit_import_seen_item(is_import, user_id, &db_metadata_id, ss, seen).await
                    {
                        import.failed.push(ImportFailedItem {
                            lot: Some(metadata.lot),
                            error: Some(e.to_string()),
                            step: ImportFailStep::DatabaseCommit,
                            identifier: metadata.source_id.to_owned(),
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
                                error: Some(e.to_string()),
                                step: ImportFailStep::DatabaseCommit,
                                identifier: metadata.source_id.to_owned(),
                            });
                        };
                    }
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
                                error: Some(e.to_string()),
                                lot: Some(metadata_group.lot),
                                step: ImportFailStep::DatabaseCommit,
                                identifier: metadata_group.title.to_owned(),
                            });
                        };
                    }
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
                                error: Some(e.to_string()),
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
                if let Err(err) = create_user_measurement(user_id, measurement.clone(), ss).await {
                    import.failed.push(ImportFailedItem {
                        error: Some(err.to_string()),
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
