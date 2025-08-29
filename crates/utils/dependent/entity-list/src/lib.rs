use std::sync::Arc;

use anyhow::Result;
use application_utils::graphql_to_db_order;
use common_models::{SearchDetails, SearchInput, UserLevelCacheKey};
use database_models::{
    collection, collection_to_entity, enriched_user_to_exercise, enriched_user_to_metadata,
    enriched_user_to_metadata_group, enriched_user_to_person, genre, prelude::*, user_measurement,
    user_to_entity, workout, workout_template,
};
use database_utils::{
    apply_collection_filters, apply_columns_search, user_preferences_list_page_size,
};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CachedResponse, SearchResults,
    UserCollectionsListResponse, UserExercisesListResponse, UserMeasurementsListResponse,
    UserMetadataGroupsListInput, UserMetadataGroupsListResponse, UserMetadataListInput,
    UserMetadataListResponse, UserPeopleListInput, UserPeopleListResponse,
    UserTemplatesOrWorkoutsListInput, UserTemplatesOrWorkoutsListSortBy, UserWorkoutsListResponse,
    UserWorkoutsTemplatesListResponse,
};
use enum_models::{ExerciseSource, SeenState, UserToMediaReason};
use fitness_models::{ExerciseSortBy, UserExercisesListInput, UserMeasurementsListInput};
use media_models::{
    CollectionItem, GenreListItem, MediaGeneralFilter, MediaSortBy, PersonAndMetadataGroupsSortBy,
};
use migrations::{
    AliasedCollection, AliasedCollectionToEntity, AliasedMetadataToGenre, AliasedUser,
    AliasedUserToEntity,
};
use sea_orm::Iterable;
use sea_orm::sea_query::{Query, SimpleExpr};
use sea_orm::{
    ColumnTrait, EntityTrait, ItemsAndPagesNumber, JoinType, Order, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, QueryTrait, RelationTrait,
    prelude::Expr,
    sea_query::{Alias, Func, NullOrdering, PgFunc},
};
use supporting_service::SupportingService;

pub async fn user_metadata_list(
    user_id: &String,
    input: UserMetadataListInput,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<UserMetadataListResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserMetadataList(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.to_owned(),
        }),
        ApplicationCacheValue::UserMetadataList,
        || async {
            let order_by = input
                .sort
                .clone()
                .map(|a| graphql_to_db_order(a.order))
                .unwrap_or(Order::Asc);
            let page_size = user_preferences_list_page_size(user_id, ss).await?;
            let take = input
                .search
                .clone()
                .and_then(|s| s.take)
                .unwrap_or(page_size);
            let page: u64 = input
                .search
                .clone()
                .and_then(|s| s.page)
                .unwrap_or(1)
                .try_into()
                .unwrap();
            let paginator = EnrichedUserToMetadata::find()
                .select_only()
                .column(enriched_user_to_metadata::Column::MetadataId)
                .filter(enriched_user_to_metadata::Column::UserId.eq(user_id))
                .apply_if(input.lot, |query, v| {
                    query.filter(enriched_user_to_metadata::Column::Lot.eq(v))
                })
                .apply_if(input.search.and_then(|s| s.query), |query, v| {
                    query.filter(apply_columns_search(
                        &v,
                        [
                            Expr::col(enriched_user_to_metadata::Column::Title),
                            Expr::col(enriched_user_to_metadata::Column::Description),
                        ],
                    ))
                })
                .apply_if(
                    input.filter.clone().and_then(|f| f.date_range),
                    |outer_query, outer_value| {
                        outer_query
                            .apply_if(outer_value.start_date, |inner_query, inner_value| {
                                inner_query.filter(
                                    enriched_user_to_metadata::Column::MaxSeenFinishedOn
                                        .gte(inner_value),
                                )
                            })
                            .apply_if(outer_value.end_date, |inner_query, inner_value| {
                                inner_query.filter(
                                    enriched_user_to_metadata::Column::MaxSeenFinishedOn
                                        .lte(inner_value),
                                )
                            })
                    },
                )
                .apply_if(
                    input.filter.clone().and_then(|f| f.collections),
                    |query, collections| {
                        apply_collection_filters(
                            enriched_user_to_metadata::Column::CollectionIds,
                            query,
                            collections,
                        )
                    },
                )
                .apply_if(input.filter.and_then(|f| f.general), |query, v| {
                    let sa = PgFunc::any(Expr::col(enriched_user_to_metadata::Column::SeenStates));
                    let filter_expression = match v {
                        MediaGeneralFilter::Dropped => Expr::val(SeenState::Dropped).eq(sa),
                        MediaGeneralFilter::OnAHold => Expr::val(SeenState::OnAHold).eq(sa),
                        MediaGeneralFilter::Unrated => {
                            enriched_user_to_metadata::Column::AverageRating.is_null()
                        }
                        MediaGeneralFilter::All => {
                            enriched_user_to_metadata::Column::MetadataId.is_not_null()
                        }
                        MediaGeneralFilter::Rated => {
                            enriched_user_to_metadata::Column::AverageRating.is_not_null()
                        }
                        MediaGeneralFilter::Unfinished => {
                            Expr::expr(Expr::val(UserToMediaReason::Finished).eq(PgFunc::any(
                                Expr::col(enriched_user_to_metadata::Column::MediaReason),
                            )))
                            .not()
                        }
                    };
                    query.filter(filter_expression)
                })
                .apply_if(input.sort.map(|s| s.by), |query, v| match v {
                    MediaSortBy::Title => {
                        query.order_by(enriched_user_to_metadata::Column::Title, order_by)
                    }
                    MediaSortBy::Random => query.order_by(Expr::expr(Func::random()), order_by),
                    MediaSortBy::TimesConsumed => {
                        query.order_by(enriched_user_to_metadata::Column::TimesSeen, order_by)
                    }
                    MediaSortBy::LastUpdated => {
                        query.order_by(enriched_user_to_metadata::Column::LastUpdatedOn, order_by)
                    }
                    MediaSortBy::ReleaseDate => query.order_by_with_nulls(
                        enriched_user_to_metadata::Column::PublishDate,
                        order_by,
                        NullOrdering::Last,
                    ),
                    MediaSortBy::LastConsumed => query.order_by_with_nulls(
                        enriched_user_to_metadata::Column::MaxSeenFinishedOn,
                        order_by,
                        NullOrdering::Last,
                    ),
                    MediaSortBy::UserRating => query.order_by_with_nulls(
                        enriched_user_to_metadata::Column::AverageRating,
                        order_by,
                        NullOrdering::Last,
                    ),
                    MediaSortBy::ProviderRating => query.order_by_with_nulls(
                        enriched_user_to_metadata::Column::ProviderRating,
                        order_by,
                        NullOrdering::Last,
                    ),
                })
                .order_by_desc(enriched_user_to_metadata::Column::MaxSeenLastUpdatedOn)
                .into_tuple::<String>()
                .paginate(&ss.db, take);
            let ItemsAndPagesNumber {
                number_of_items,
                number_of_pages,
            } = paginator.num_items_and_pages().await?;
            let mut items = vec![];
            for c in paginator.fetch_page(page - 1).await? {
                items.push(c);
            }
            let response = SearchResults {
                items,
                details: SearchDetails {
                    total_items: number_of_items.try_into().unwrap(),
                    next_page: (page < number_of_pages).then(|| (page + 1).try_into().unwrap()),
                },
            };
            Ok(response)
        },
    )
    .await
}

pub async fn user_collections_list(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<UserCollectionsListResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserCollectionsList(UserLevelCacheKey {
            input: (),
            user_id: user_id.to_owned(),
        }),
        ApplicationCacheValue::UserCollectionsList,
        || async {
            let user_jsonb_build_object = PgFunc::json_build_object(vec![
                (
                    Expr::val("id"),
                    Expr::col((AliasedUser::Table, AliasedUser::Id)),
                ),
                (
                    Expr::val("name"),
                    Expr::col((AliasedUser::Table, AliasedUser::Name)),
                ),
            ]);
            let outer_collaborator = PgFunc::json_build_object(vec![
                (
                    Expr::val("collaborator"),
                    Expr::expr(user_jsonb_build_object.clone()),
                ),
                (
                    Expr::val("extra_information"),
                    Expr::col((
                        AliasedUserToEntity::Table,
                        AliasedUserToEntity::CollectionExtraInformation,
                    )),
                ),
            ]);
            let collaborators_subquery = Query::select()
                .from(UserToEntity)
                .expr(PgFunc::json_agg(outer_collaborator.clone()))
                .join(
                    JoinType::InnerJoin,
                    AliasedUser::Table,
                    Expr::col((AliasedUserToEntity::Table, AliasedUserToEntity::UserId))
                        .equals((AliasedUser::Table, AliasedUser::Id)),
                )
                .and_where(
                    Expr::col((
                        AliasedUserToEntity::Table,
                        AliasedUserToEntity::CollectionId,
                    ))
                    .equals((AliasedCollection::Table, AliasedCollection::Id)),
                )
                .to_owned();
            let count_subquery = Query::select()
                .expr(collection_to_entity::Column::Id.count())
                .from(CollectionToEntity)
                .and_where(
                    Expr::col((
                        AliasedCollectionToEntity::Table,
                        AliasedCollectionToEntity::CollectionId,
                    ))
                    .equals((
                        AliasedUserToEntity::Table,
                        AliasedUserToEntity::CollectionId,
                    )),
                )
                .to_owned();
            let response = Collection::find()
                .select_only()
                .column(collection::Column::Id)
                .column(collection::Column::Name)
                .column_as(
                    collection::Column::Name
                        .is_in(common_models::DefaultCollection::iter().map(|s| s.to_string()))
                        .and(collection::Column::UserId.eq(user_id)),
                    "is_default",
                )
                .column(collection::Column::InformationTemplate)
                .expr_as(
                    SimpleExpr::SubQuery(None, Box::new(count_subquery.into_sub_query_statement())),
                    "count",
                )
                .expr_as(
                    Func::coalesce([
                        SimpleExpr::SubQuery(
                            None,
                            Box::new(collaborators_subquery.into_sub_query_statement()),
                        ),
                        SimpleExpr::FunctionCall(Func::cast_as(
                            Expr::val("[]"),
                            Alias::new("JSON"),
                        )),
                    ]),
                    "collaborators",
                )
                .column(collection::Column::Description)
                .column_as(Expr::expr(user_jsonb_build_object), "creator")
                .order_by_desc(collection::Column::LastUpdatedOn)
                .left_join(User)
                .left_join(UserToEntity)
                .filter(user_to_entity::Column::UserId.eq(user_id))
                .into_model::<CollectionItem>()
                .all(&ss.db)
                .await
                .unwrap();
            Ok(response)
        },
    )
    .await
}

pub async fn user_metadata_groups_list(
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: UserMetadataGroupsListInput,
) -> Result<CachedResponse<UserMetadataGroupsListResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserMetadataGroupsList(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.to_owned(),
        }),
        ApplicationCacheValue::UserMetadataGroupsList,
        || async {
            let page: u64 = input
                .search
                .clone()
                .and_then(|f| f.page)
                .unwrap_or(1)
                .try_into()
                .unwrap();
            let (order_by, sort_order) = match input.sort {
                None => (
                    Expr::col(enriched_user_to_metadata_group::Column::Parts),
                    Order::Desc,
                ),
                Some(ord) => (
                    match ord.by {
                        PersonAndMetadataGroupsSortBy::Random => Expr::expr(Func::random()),
                        PersonAndMetadataGroupsSortBy::AssociatedEntityCount => {
                            Expr::col(enriched_user_to_metadata_group::Column::Parts)
                        }
                        PersonAndMetadataGroupsSortBy::Name => {
                            Expr::col(enriched_user_to_metadata_group::Column::Title)
                        }
                    },
                    graphql_to_db_order(ord.order),
                ),
            };
            let page_size = user_preferences_list_page_size(user_id, ss).await?;
            let take = input
                .search
                .clone()
                .and_then(|s| s.take)
                .unwrap_or(page_size);
            let paginator = EnrichedUserToMetadataGroup::find()
                .select_only()
                .column(enriched_user_to_metadata_group::Column::MetadataGroupId)
                .filter(enriched_user_to_metadata_group::Column::UserId.eq(user_id))
                .apply_if(input.search.and_then(|f| f.query), |query, v| {
                    query.filter(apply_columns_search(
                        &v,
                        [
                            Expr::col(enriched_user_to_metadata_group::Column::Title),
                            Expr::col(enriched_user_to_metadata_group::Column::Description),
                        ],
                    ))
                })
                .apply_if(
                    input.filter.clone().and_then(|f| f.collections),
                    |query, collections| {
                        apply_collection_filters(
                            enriched_user_to_metadata_group::Column::CollectionIds,
                            query,
                            collections,
                        )
                    },
                )
                .order_by(order_by, sort_order)
                .into_tuple::<String>()
                .paginate(&ss.db, take);
            let ItemsAndPagesNumber {
                number_of_items,
                number_of_pages,
            } = paginator.num_items_and_pages().await?;
            let mut items = vec![];
            for c in paginator.fetch_page(page - 1).await? {
                items.push(c);
            }
            let response = SearchResults {
                items,
                details: SearchDetails {
                    total_items: number_of_items.try_into().unwrap(),
                    next_page: (page < number_of_pages).then(|| (page + 1).try_into().unwrap()),
                },
            };
            Ok(response)
        },
    )
    .await
}

pub async fn user_people_list(
    user_id: &String,
    input: UserPeopleListInput,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<UserPeopleListResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserPeopleList(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.clone(),
        }),
        ApplicationCacheValue::UserPeopleList,
        || async {
            let page: u64 = input
                .search
                .clone()
                .and_then(|f| f.page)
                .unwrap_or(1)
                .try_into()
                .unwrap();
            let (order_by, sort_order) = match input.sort {
                None => (
                    Expr::col(enriched_user_to_person::Column::AssociatedEntityCount),
                    Order::Desc,
                ),
                Some(ord) => (
                    match ord.by {
                        PersonAndMetadataGroupsSortBy::Random => Expr::expr(Func::random()),
                        PersonAndMetadataGroupsSortBy::Name => {
                            Expr::col(enriched_user_to_person::Column::Name)
                        }
                        PersonAndMetadataGroupsSortBy::AssociatedEntityCount => {
                            Expr::col(enriched_user_to_person::Column::AssociatedEntityCount)
                        }
                    },
                    graphql_to_db_order(ord.order),
                ),
            };
            let page_size = user_preferences_list_page_size(user_id, ss).await?;
            let take = input
                .search
                .clone()
                .and_then(|s| s.take)
                .unwrap_or(page_size);
            let creators_paginator = EnrichedUserToPerson::find()
                .select_only()
                .column(enriched_user_to_person::Column::PersonId)
                .filter(enriched_user_to_person::Column::UserId.eq(user_id))
                .apply_if(input.search.clone().and_then(|s| s.query), |query, v| {
                    query.filter(apply_columns_search(
                        &v,
                        [
                            Expr::col(enriched_user_to_person::Column::Name),
                            Expr::col(enriched_user_to_person::Column::Description),
                        ],
                    ))
                })
                .apply_if(
                    input.filter.clone().and_then(|f| f.collections),
                    |query, collections| {
                        apply_collection_filters(
                            enriched_user_to_person::Column::CollectionIds,
                            query,
                            collections,
                        )
                    },
                )
                .order_by(order_by, sort_order)
                .into_tuple::<String>()
                .paginate(&ss.db, take);
            let ItemsAndPagesNumber {
                number_of_items,
                number_of_pages,
            } = creators_paginator.num_items_and_pages().await?;
            let mut items = vec![];
            for cr in creators_paginator.fetch_page(page - 1).await? {
                items.push(cr);
            }
            let response = SearchResults {
                items,
                details: SearchDetails {
                    total_items: number_of_items.try_into().unwrap(),
                    next_page: (page < number_of_pages).then(|| (page + 1).try_into().unwrap()),
                },
            };
            Ok(response)
        },
    )
    .await
}

pub async fn user_workouts_list(
    user_id: &String,
    input: UserTemplatesOrWorkoutsListInput,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<UserWorkoutsListResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserWorkoutsList(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.to_owned(),
        }),
        ApplicationCacheValue::UserWorkoutsList,
        || async {
            let page = input.search.page.unwrap_or(1);
            let page_size = user_preferences_list_page_size(user_id, ss).await?;
            let take = input.search.take.unwrap_or(page_size);
            let paginator = Workout::find()
                .select_only()
                .column(workout::Column::Id)
                .filter(workout::Column::UserId.eq(user_id))
                .apply_if(input.search.query, |query, v| {
                    query.filter(apply_columns_search(&v, [Expr::col(workout::Column::Name)]))
                })
                .apply_if(input.sort, |query, v| {
                    query.order_by(
                        match v.by {
                            UserTemplatesOrWorkoutsListSortBy::Random => Expr::expr(Func::random()),
                            UserTemplatesOrWorkoutsListSortBy::Time => {
                                Expr::col(workout::Column::EndTime)
                            }
                        },
                        graphql_to_db_order(v.order),
                    )
                })
                .into_tuple::<String>()
                .paginate(&ss.db, take);
            let ItemsAndPagesNumber {
                number_of_items,
                number_of_pages,
            } = paginator.num_items_and_pages().await?;
            let items = paginator.fetch_page((page - 1).try_into().unwrap()).await?;
            let response = SearchResults {
                items,
                details: SearchDetails {
                    total_items: number_of_items.try_into().unwrap(),
                    next_page: (page < number_of_pages.try_into().unwrap()).then(|| page + 1),
                },
            };
            Ok(response)
        },
    )
    .await
}

pub async fn user_workout_templates_list(
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: UserTemplatesOrWorkoutsListInput,
) -> Result<CachedResponse<UserWorkoutsTemplatesListResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserWorkoutTemplatesList(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.to_owned(),
        }),
        ApplicationCacheValue::UserWorkoutTemplatesList,
        || async {
            let page = input.search.page.unwrap_or(1);
            let page_size = user_preferences_list_page_size(user_id, ss).await?;
            let take = input.search.take.unwrap_or(page_size);
            let paginator = WorkoutTemplate::find()
                .select_only()
                .column(workout_template::Column::Id)
                .filter(workout_template::Column::UserId.eq(user_id))
                .apply_if(input.search.query, |query, v| {
                    query.filter(apply_columns_search(
                        &v,
                        [Expr::col(workout_template::Column::Name)],
                    ))
                })
                .apply_if(input.sort, |query, v| {
                    query.order_by(
                        match v.by {
                            UserTemplatesOrWorkoutsListSortBy::Random => Expr::expr(Func::random()),
                            UserTemplatesOrWorkoutsListSortBy::Time => {
                                Expr::col(workout_template::Column::CreatedOn)
                            }
                        },
                        graphql_to_db_order(v.order),
                    )
                })
                .into_tuple::<String>()
                .paginate(&ss.db, take);
            let ItemsAndPagesNumber {
                number_of_items,
                number_of_pages,
            } = paginator.num_items_and_pages().await?;
            let items = paginator.fetch_page((page - 1).try_into().unwrap()).await?;
            let response = SearchResults {
                items,
                details: SearchDetails {
                    total_items: number_of_items.try_into().unwrap(),
                    next_page: (page < number_of_pages.try_into().unwrap()).then(|| page + 1),
                },
            };
            Ok(response)
        },
    )
    .await
}

pub async fn user_exercises_list(
    user_id: &String,
    input: UserExercisesListInput,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<UserExercisesListResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserExercisesList(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.to_owned(),
        }),
        ApplicationCacheValue::UserExercisesList,
        || async {
            let user_id = user_id.to_owned();
            let page_size = user_preferences_list_page_size(&user_id, ss).await?;
            let take = input.search.take.unwrap_or(page_size);
            let page = input.search.page.unwrap_or(1);
            let order_by_col = match input.sort_by {
                None => Expr::col(enriched_user_to_exercise::Column::ExerciseId),
                Some(sb) => match sb {
                    // DEV: This is just a small hack to reduce duplicated code. We
                    // are ordering by name for the other `sort_by` anyway.
                    ExerciseSortBy::Name => Expr::val("1"),
                    ExerciseSortBy::Random => Expr::expr(Func::random()),
                    ExerciseSortBy::TimesPerformed => Expr::expr(Func::coalesce([
                        Expr::col(enriched_user_to_exercise::Column::NumTimesInteracted).into(),
                        Expr::val(0).into(),
                    ])),
                    ExerciseSortBy::LastPerformed => Expr::expr(Func::coalesce([
                        Expr::col(enriched_user_to_exercise::Column::LastUpdatedOn).into(),
                        // DEV: For some reason this does not work without explicit casting on postgres
                        Func::cast_as(Expr::val("1900-01-01"), Alias::new("timestamptz")).into(),
                    ])),
                },
            };
            let paginator = EnrichedUserToExercise::find()
                .select_only()
                .column(enriched_user_to_exercise::Column::ExerciseId)
                .filter(
                    enriched_user_to_exercise::Column::Source
                        .eq(ExerciseSource::Github)
                        .or(enriched_user_to_exercise::Column::CreatedByUserId.eq(&user_id)),
                )
                .apply_if(input.filter, |query, q| {
                    query
                        .apply_if(q.lot, |q, v| {
                            q.filter(enriched_user_to_exercise::Column::Lot.eq(v))
                        })
                        .apply_if(q.muscle, |q, v| {
                            q.filter(Expr::val(v).eq(PgFunc::any(Expr::col(
                                enriched_user_to_exercise::Column::Muscles,
                            ))))
                        })
                        .apply_if(q.level, |q, v| {
                            q.filter(enriched_user_to_exercise::Column::Level.eq(v))
                        })
                        .apply_if(q.force, |q, v| {
                            q.filter(enriched_user_to_exercise::Column::Force.eq(v))
                        })
                        .apply_if(q.mechanic, |q, v| {
                            q.filter(enriched_user_to_exercise::Column::Mechanic.eq(v))
                        })
                        .apply_if(q.equipment, |q, v| {
                            q.filter(enriched_user_to_exercise::Column::Equipment.eq(v))
                        })
                        .apply_if(q.collection, |q, v| {
                            q.filter(Expr::val(v).eq(PgFunc::any(Expr::col(
                                enriched_user_to_exercise::Column::CollectionIds,
                            ))))
                        })
                })
                .apply_if(input.search.query, |query, v| {
                    query.filter(apply_columns_search(
                        &v,
                        [
                            Expr::col(enriched_user_to_exercise::Column::ExerciseId),
                            Expr::col(enriched_user_to_exercise::Column::Name),
                        ],
                    ))
                })
                .order_by_desc(order_by_col)
                .order_by_asc(enriched_user_to_exercise::Column::ExerciseId)
                .into_tuple::<String>()
                .paginate(&ss.db, take);
            let ItemsAndPagesNumber {
                number_of_items,
                number_of_pages,
            } = paginator.num_items_and_pages().await?;
            let mut items = vec![];
            for ex in paginator.fetch_page((page - 1).try_into().unwrap()).await? {
                items.push(ex);
            }
            let response = SearchResults {
                items,
                details: SearchDetails {
                    total_items: number_of_items.try_into().unwrap(),
                    next_page: (page < number_of_pages.try_into().unwrap()).then(|| page + 1),
                },
            };
            Ok(response)
        },
    )
    .await
}

pub async fn user_measurements_list(
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: UserMeasurementsListInput,
) -> Result<CachedResponse<UserMeasurementsListResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserMeasurementsList(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.to_owned(),
        }),
        ApplicationCacheValue::UserMeasurementsList,
        || async {
            let resp = UserMeasurement::find()
                .apply_if(input.start_time, |query, v| {
                    query.filter(user_measurement::Column::Timestamp.gte(v))
                })
                .apply_if(input.end_time, |query, v| {
                    query.filter(user_measurement::Column::Timestamp.lte(v))
                })
                .filter(user_measurement::Column::UserId.eq(user_id))
                .order_by_asc(user_measurement::Column::Timestamp)
                .all(&ss.db)
                .await?;
            Ok(resp)
        },
    )
    .await
}

pub async fn user_genres_list(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: SearchInput,
) -> Result<SearchResults<String>> {
    let page: u64 = input.page.unwrap_or(1).try_into().unwrap();
    let num_items = "num_items";
    let query = Genre::find()
        .column_as(
            Expr::expr(Func::count(Expr::col((
                AliasedMetadataToGenre::Table,
                AliasedMetadataToGenre::MetadataId,
            )))),
            num_items,
        )
        .apply_if(input.query, |query, v| {
            query.filter(apply_columns_search(&v, [Expr::col(genre::Column::Name)]))
        })
        .join(JoinType::Join, genre::Relation::MetadataToGenre.def())
        .group_by(Expr::tuple([
            Expr::col(genre::Column::Id).into(),
            Expr::col(genre::Column::Name).into(),
        ]))
        .order_by(Expr::col(Alias::new(num_items)), Order::Desc);
    let page_size = user_preferences_list_page_size(&user_id, ss).await?;
    let paginator = query
        .clone()
        .into_model::<GenreListItem>()
        .paginate(&ss.db, page_size);
    let ItemsAndPagesNumber {
        number_of_items,
        number_of_pages,
    } = paginator.num_items_and_pages().await?;
    let mut items = vec![];
    for c in paginator.fetch_page(page - 1).await? {
        items.push(c.id);
    }
    Ok(SearchResults {
        items,
        details: SearchDetails {
            total_items: number_of_items.try_into().unwrap(),
            next_page: (page < number_of_pages).then(|| (page + 1).try_into().unwrap()),
        },
    })
}
