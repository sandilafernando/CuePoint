import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import initSqlJs from 'sql.js'
import type { Database, SqlJsStatic, SqlValue } from 'sql.js'
import { AppError } from './errors'

export type SqlParam = number | string | null | Uint8Array

let sqlJsPromise: Promise<SqlJsStatic> | null = null

/**
 * Loads the SQLite engine (sql.js: SQLite compiled to WebAssembly).
 *
 * A WASM build is used deliberately instead of a native addon: CuePoint ships a
 * Windows installer, and a native module would require an MSVC/Electron-ABI rebuild
 * on every machine. sql.js is the real SQLite engine, so the on-disk files remain
 * ordinary SQLite databases that any SQLite tool can open.
 */
export async function loadSqlEngine(wasmPath: string): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({ locateFile: () => wasmPath })
  }
  try {
    return await sqlJsPromise
  } catch (error) {
    sqlJsPromise = null
    throw new AppError(
      'E_DB',
      'The SQLite engine could not be initialised.',
      { hint: 'Reinstall CuePoint; the packaged sql.js payload appears to be missing or damaged.', detail: String(error) }
    )
  }
}

export interface OpenOptions {
  wasmPath: string
  /** SQL executed after opening (CREATE TABLE IF NOT EXISTS ...). */
  schema?: string
  /** Set false to open read-only (no persist will occur). */
  writable?: boolean
}

/**
 * Thin, typed wrapper around a sql.js database that owns its file.
 * Writes are explicit (`persist`) and atomic (temp file + rename).
 */
export class SqliteDb {
  readonly filePath: string
  private db: Database
  private writable: boolean
  private dirty = false
  private persistTimer: NodeJS.Timeout | null = null
  private persistChain: Promise<unknown> = Promise.resolve()
  private closed = false

  private constructor(filePath: string, db: Database, writable: boolean) {
    this.filePath = filePath
    this.db = db
    this.writable = writable
  }

  static async open(filePath: string, options: OpenOptions): Promise<SqliteDb> {
    const SQL = await loadSqlEngine(options.wasmPath)
    const writable = options.writable !== false
    await mkdir(path.dirname(filePath), { recursive: true })

    let data: Uint8Array | undefined
    try {
      data = new Uint8Array(await readFile(filePath))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        throw new AppError('E_DB', `The database "${path.basename(filePath)}" could not be read.`, {
          hint: 'Restore the file from a recovery snapshot, or restore your backup copy.',
          detail: String(error)
        })
      }
    }

    let db: Database
    try {
      db = data && data.length > 0 ? new SQL.Database(data) : new SQL.Database()
    } catch (error) {
      throw new AppError(
        'E_DB',
        `The database "${path.basename(filePath)}" is not a valid SQLite file.`,
        {
          hint: 'Open a recovery snapshot instead (Home → Recover Project).',
          detail: String(error)
        }
      )
    }

    const instance = new SqliteDb(filePath, db, writable)
    if (options.schema) instance.exec(options.schema)
    if (!data) instance.dirty = writable
    return instance
  }

  get sizeBytesFile(): string {
    return this.filePath
  }

  exec(sql: string): void {
    this.db.exec(sql)
    this.dirty = true
  }

  run(sql: string, params: SqlParam[] = []): void {
    const stmt = this.db.prepare(sql)
    try {
      stmt.bind(params as SqlValue[])
      stmt.step()
    } finally {
      stmt.free()
    }
    this.dirty = true
  }

  runMany(statements: { sql: string; params?: SqlParam[] }[]): void {
    for (const statement of statements) this.run(statement.sql, statement.params ?? [])
  }

  query<T = Record<string, SqlValue>>(sql: string, params: SqlParam[] = []): T[] {
    const stmt = this.db.prepare(sql)
    const rows: T[] = []
    try {
      stmt.bind(params as SqlValue[])
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as unknown as T)
      }
    } finally {
      stmt.free()
    }
    return rows
  }

  one<T = Record<string, SqlValue>>(sql: string, params: SqlParam[] = []): T | null {
    return this.query<T>(sql, params)[0] ?? null
  }

  scalar<T = SqlValue>(sql: string, params: SqlParam[] = []): T | null {
    const row = this.one<Record<string, SqlValue>>(sql, params)
    if (!row) return null
    const values = Object.values(row)
    return (values[0] as T) ?? null
  }

  /** Executes `fn` inside a transaction, rolling back on any error. */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      this.dirty = true
      return result
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // A failed rollback is reported through the original error.
      }
      throw error
    }
  }

  get isDirty(): boolean {
    return this.dirty
  }

  get isWritable(): boolean {
    return this.writable
  }

  async bytes(): Promise<Uint8Array> {
    return this.db.export()
  }

  /** Writes the database atomically. `backup` keeps a copy of the previous file. */
  async persist(options: { backup?: boolean; backupPath?: string } = {}): Promise<number> {
    if (!this.writable) {
      throw new AppError('E_DB', 'This database was opened read-only.')
    }
    const run = async (): Promise<number> => {
      const payload = this.db.export()
      const temp = `${this.filePath}.tmp`
      await writeFile(temp, payload)
      if (options.backup) {
        try {
          await stat(this.filePath)
          await copyFile(this.filePath, options.backupPath ?? `${this.filePath}.bak`)
        } catch {
          // First save: there is nothing to back up.
        }
      }
      await rename(temp, this.filePath)
      this.dirty = false
      return payload.length
    }
    const chained = this.persistChain.then(run, run)
    this.persistChain = chained
    return chained
  }

  /** Coalesces rapid writes into a single file write. */
  schedulePersist(delayMs = 250): void {
    if (!this.writable) return
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      void this.persist().catch(() => undefined)
    }, delayMs)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    if (this.writable && this.dirty) {
      await this.persist().catch(() => undefined)
    }
    this.db.close()
  }

  async fileBytes(): Promise<number> {
    try {
      return (await stat(this.filePath)).size
    } catch {
      return 0
    }
  }

  async deleteFile(): Promise<void> {
    await unlink(this.filePath).catch(() => undefined)
  }
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}
