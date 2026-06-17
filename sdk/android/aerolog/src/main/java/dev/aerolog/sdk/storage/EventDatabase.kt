package dev.aerolog.sdk.storage

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase

@Entity(tableName = "events")
internal data class StoredEvent(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "payload") val payload: String,
    @ColumnInfo(name = "created_at") val createdAt: Long,
)

@Dao
internal interface EventDao {
    @Insert
    suspend fun insert(e: StoredEvent): Long

    @Query("SELECT * FROM events ORDER BY id ASC LIMIT :n")
    suspend fun take(n: Int): List<StoredEvent>

    @Query("DELETE FROM events WHERE id IN (:ids)")
    suspend fun delete(ids: List<Long>)

    @Query("SELECT COUNT(*) FROM events")
    suspend fun count(): Int

    @Query("DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY id ASC LIMIT :n)")
    suspend fun trimOldest(n: Int)
}

@Database(entities = [StoredEvent::class], version = 1, exportSchema = false)
internal abstract class EventDatabase : RoomDatabase() {
    abstract fun events(): EventDao
}
