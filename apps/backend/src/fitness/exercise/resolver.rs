use sea_orm::DatabaseConnection;

#[derive(Debug)]
pub struct ExerciseService {
    db: DatabaseConnection,
}
