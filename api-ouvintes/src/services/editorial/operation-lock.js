import { pool } from "../../database/client.js";
import { AppError } from "../../lib/errors.js";
import { env } from "../../config/env.js";
// Session locks serialize external side effects without an open SQL transaction.
export async function withEditorialLock(key, operation) {
    // Neon transaction pooling does not preserve session advisory-lock ownership.
    if (new URL(env.DATABASE_URL).hostname.includes("-pooler.")) {
        throw new AppError(503, "FEED_SESSION_CONNECTION_REQUIRED", "Operacoes editoriais exigem conexao PostgreSQL direta, sem pooler transacional.");
    }
    const db = await pool.connect();
    let locked = false;
    let destroy = false;
    try {
        const result = await db.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [key]);
        locked = result.rows[0]?.locked === true;
        if (!locked)
            throw new AppError(409, "FEED_OPERATION_IN_PROGRESS", "Esta operacao editorial ja esta em andamento. Tente novamente.");
        return await operation(db);
    }
    finally {
        if (locked) {
            try {
                await db.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]);
            }
            catch {
                destroy = true;
            }
        }
        db.release(destroy);
    }
}
