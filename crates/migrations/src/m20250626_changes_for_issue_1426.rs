use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                r#"
                -- Step 1: Handle FK references to consolidate to older person records
                -- For collection_to_entity: Delete newer person references if older already exists
                DELETE FROM collection_to_entity 
                WHERE id IN (
                    SELECT cte2.id
                    FROM collection_to_entity cte1
                    JOIN collection_to_entity cte2 ON cte1.collection_id = cte2.collection_id
                    JOIN (
                        SELECT 
                            MIN(id) as older_id,
                            MAX(id) as newer_id
                        FROM person 
                        WHERE (identifier, source) IN (
                            SELECT identifier, source
                            FROM person 
                            GROUP BY identifier, source
                            HAVING COUNT(*) > 1
                        )
                        GROUP BY identifier, source
                    ) older_persons ON cte1.person_id = older_persons.older_id 
                        AND cte2.person_id = older_persons.newer_id
                );
                
                -- Update remaining collection_to_entity references
                UPDATE collection_to_entity 
                SET person_id = older_persons.older_id
                FROM (
                    SELECT 
                        MIN(id) as older_id,
                        MAX(id) as newer_id
                    FROM person 
                    WHERE (identifier, source) IN (
                        SELECT identifier, source
                        FROM person 
                        GROUP BY identifier, source
                        HAVING COUNT(*) > 1
                    )
                    GROUP BY identifier, source
                ) older_persons
                WHERE collection_to_entity.person_id = older_persons.newer_id;

                -- For user_to_entity: Delete newer person references if older already exists
                DELETE FROM user_to_entity 
                WHERE id IN (
                    SELECT ute2.id
                    FROM user_to_entity ute1
                    JOIN user_to_entity ute2 ON ute1.user_id = ute2.user_id
                    JOIN (
                        SELECT 
                            MIN(id) as older_id,
                            MAX(id) as newer_id
                        FROM person 
                        WHERE (identifier, source) IN (
                            SELECT identifier, source
                            FROM person 
                            GROUP BY identifier, source
                            HAVING COUNT(*) > 1
                        )
                        GROUP BY identifier, source
                    ) older_persons ON ute1.person_id = older_persons.older_id 
                        AND ute2.person_id = older_persons.newer_id
                );
                
                -- Update remaining user_to_entity references
                UPDATE user_to_entity 
                SET person_id = older_persons.older_id
                FROM (
                    SELECT 
                        MIN(id) as older_id,
                        MAX(id) as newer_id
                    FROM person 
                    WHERE (identifier, source) IN (
                        SELECT identifier, source
                        FROM person 
                        GROUP BY identifier, source
                        HAVING COUNT(*) > 1
                    )
                    GROUP BY identifier, source
                ) older_persons
                WHERE user_to_entity.person_id = older_persons.newer_id;

                UPDATE review 
                SET person_id = older_persons.older_id
                FROM (
                    SELECT 
                        MIN(id) as older_id,
                        MAX(id) as newer_id
                    FROM person 
                    WHERE (identifier, source) IN (
                        SELECT identifier, source
                        FROM person 
                        GROUP BY identifier, source
                        HAVING COUNT(*) > 1
                    )
                    GROUP BY identifier, source
                ) older_persons
                WHERE review.person_id = older_persons.newer_id;

                UPDATE metadata_group_to_person 
                SET person_id = older_persons.older_id
                FROM (
                    SELECT 
                        MIN(id) as older_id,
                        MAX(id) as newer_id
                    FROM person 
                    WHERE (identifier, source) IN (
                        SELECT identifier, source
                        FROM person 
                        GROUP BY identifier, source
                        HAVING COUNT(*) > 1
                    )
                    GROUP BY identifier, source
                ) older_persons
                WHERE metadata_group_to_person.person_id = older_persons.newer_id;

                -- Step 2: Delete conflicting newer metadata_to_person references
                DELETE FROM metadata_to_person
                WHERE person_id IN (
                    SELECT newer_id
                    FROM (
                        SELECT 
                            MIN(id) as older_id,
                            MAX(id) as newer_id
                        FROM person 
                        WHERE (identifier, source) IN (
                            SELECT identifier, source
                            FROM person 
                            GROUP BY identifier, source
                            HAVING COUNT(*) > 1
                        )
                        GROUP BY identifier, source
                    ) duplicates
                )
                AND (metadata_id, role) IN (
                    SELECT mtp1.metadata_id, mtp1.role
                    FROM metadata_to_person mtp1
                    JOIN (
                        SELECT 
                            MIN(id) as older_id,
                            MAX(id) as newer_id
                        FROM person 
                        WHERE (identifier, source) IN (
                            SELECT identifier, source
                            FROM person 
                            GROUP BY identifier, source
                            HAVING COUNT(*) > 1
                        )
                        GROUP BY identifier, source
                    ) duplicates ON mtp1.person_id = duplicates.older_id
                    JOIN metadata_to_person mtp2 ON mtp2.person_id = duplicates.newer_id 
                        AND mtp1.metadata_id = mtp2.metadata_id 
                        AND mtp1.role = mtp2.role
                );

                -- Step 3: Update remaining non-conflicting metadata_to_person references
                UPDATE metadata_to_person 
                SET person_id = older_persons.older_id
                FROM (
                    SELECT 
                        MIN(id) as older_id,
                        MAX(id) as newer_id
                    FROM person 
                    WHERE (identifier, source) IN (
                        SELECT identifier, source
                        FROM person 
                        GROUP BY identifier, source
                        HAVING COUNT(*) > 1
                    )
                    GROUP BY identifier, source
                ) older_persons
                WHERE metadata_to_person.person_id = older_persons.newer_id;

                -- Step 4: Delete duplicate person records
                DELETE FROM person 
                WHERE id IN (
                    SELECT newer_id
                    FROM (
                        SELECT 
                            MIN(id) as older_id,
                            MAX(id) as newer_id
                        FROM person 
                        WHERE (identifier, source) IN (
                            SELECT identifier, source
                            FROM person 
                            GROUP BY identifier, source
                            HAVING COUNT(*) > 1
                        )
                        GROUP BY identifier, source
                    ) duplicates
                );

                -- Step 5: Normalize source_specifics from {} to NULL (after duplicates removed)
                UPDATE person 
                SET source_specifics = NULL 
                WHERE source_specifics = '{}';
                "#,
            )
            .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
