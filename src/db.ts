/**
 * CheckIn Database Module
 * SQLite persistence for residents, check-ins, and alerts
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import type { CheckInResponse, ScoringResult } from './scoring.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize database
const dbPath = process.env.DB_PATH || path.join(__dirname, '../data/checkin.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

/**
 * Initialize database schema
 */
export function initDatabase(): void {
  // Floors table
  db.exec(`
    CREATE TABLE IF NOT EXISTS floors (
      id TEXT PRIMARY KEY,
      building TEXT NOT NULL,
      floor_number TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // RAs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS ras (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      pin_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // RA-Floor assignments (many-to-many)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ra_floors (
      ra_id TEXT NOT NULL,
      floor_id TEXT NOT NULL,
      PRIMARY KEY (ra_id, floor_id),
      FOREIGN KEY (ra_id) REFERENCES ras(id),
      FOREIGN KEY (floor_id) REFERENCES floors(id)
    )
  `);

  // Residents table
  db.exec(`
    CREATE TABLE IF NOT EXISTS residents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      room TEXT,
      floor_id TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (floor_id) REFERENCES floors(id)
    )
  `);

  // Check-ins table
  db.exec(`
    CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resident_id TEXT NOT NULL,
      ra_id TEXT,
      floor_id TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      responses JSON NOT NULL,
      scores JSON NOT NULL,
      alert_level TEXT NOT NULL,
      FOREIGN KEY (resident_id) REFERENCES residents(id),
      FOREIGN KEY (ra_id) REFERENCES ras(id),
      FOREIGN KEY (floor_id) REFERENCES floors(id)
    )
  `);

  // Alert acknowledgments
  db.exec(`
    CREATE TABLE IF NOT EXISTS alert_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checkin_id INTEGER NOT NULL,
      acknowledged_at DATETIME,
      acknowledged_by TEXT,
      notes TEXT,
      follow_up_scheduled BOOLEAN DEFAULT FALSE,
      follow_up_completed BOOLEAN DEFAULT FALSE,
      FOREIGN KEY (checkin_id) REFERENCES checkins(id),
      FOREIGN KEY (acknowledged_by) REFERENCES ras(id)
    )
  `);

  // Create indexes for common queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_checkins_resident ON checkins(resident_id);
    CREATE INDEX IF NOT EXISTS idx_checkins_floor ON checkins(floor_id);
    CREATE INDEX IF NOT EXISTS idx_checkins_timestamp ON checkins(timestamp);
    CREATE INDEX IF NOT EXISTS idx_checkins_alert ON checkins(alert_level);
  `);

  console.log('[DB] Schema initialized');
}

// ============================================================
// FLOOR OPERATIONS
// ============================================================

export interface Floor {
  id: string;
  building: string;
  floor_number: string;
}

export function createFloor(floor: Floor): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO floors (id, building, floor_number)
    VALUES (?, ?, ?)
  `);
  stmt.run(floor.id, floor.building, floor.floor_number);
}

export function getFloors(): Floor[] {
  return db.prepare('SELECT * FROM floors ORDER BY building, floor_number').all() as Floor[];
}

export function getFloor(id: string): Floor | undefined {
  return db.prepare('SELECT * FROM floors WHERE id = ?').get(id) as Floor | undefined;
}

// ============================================================
// RA OPERATIONS
// ============================================================

export interface RA {
  id: string;
  name: string;
  email?: string;
  pin_hash?: string;
}

export function createRA(ra: RA): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO ras (id, name, email, pin_hash)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(ra.id, ra.name, ra.email || null, ra.pin_hash || null);
}

export function assignRAToFloor(raId: string, floorId: string): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO ra_floors (ra_id, floor_id)
    VALUES (?, ?)
  `);
  stmt.run(raId, floorId);
}

export function getRAFloors(raId: string): Floor[] {
  return db.prepare(`
    SELECT f.* FROM floors f
    JOIN ra_floors rf ON f.id = rf.floor_id
    WHERE rf.ra_id = ?
  `).all(raId) as Floor[];
}

// ============================================================
// RESIDENT OPERATIONS
// ============================================================

export interface Resident {
  id: string;
  name: string;
  room?: string;
  floor_id: string;
  email?: string;
  phone?: string;
}

export function createResident(resident: Resident): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO residents (id, name, room, floor_id, email, phone)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    resident.id,
    resident.name,
    resident.room || null,
    resident.floor_id,
    resident.email || null,
    resident.phone || null
  );
}

export function getResidents(floorId?: string): Resident[] {
  if (floorId) {
    return db.prepare('SELECT * FROM residents WHERE floor_id = ? ORDER BY room').all(floorId) as Resident[];
  }
  return db.prepare('SELECT * FROM residents ORDER BY floor_id, room').all() as Resident[];
}

export function getResident(id: string): Resident | undefined {
  return db.prepare('SELECT * FROM residents WHERE id = ?').get(id) as Resident | undefined;
}

export function bulkCreateResidents(residents: Resident[]): number {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO residents (id, name, room, floor_id, email, phone)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items: Resident[]) => {
    for (const r of items) {
      stmt.run(r.id, r.name, r.room || null, r.floor_id, r.email || null, r.phone || null);
    }
    return items.length;
  });

  return insertMany(residents);
}

// ============================================================
// CHECK-IN OPERATIONS
// ============================================================

export interface StoredCheckIn {
  id: number;
  resident_id: string;
  ra_id: string | null;
  floor_id: string;
  timestamp: string;
  responses: CheckInResponse;
  scores: ScoringResult;
  alert_level: string;
}

export function saveCheckIn(
  response: CheckInResponse,
  result: ScoringResult
): number {
  const stmt = db.prepare(`
    INSERT INTO checkins (resident_id, ra_id, floor_id, timestamp, responses, scores, alert_level)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const info = stmt.run(
    response.residentId,
    response.raId || null,
    response.floor,
    response.timestamp.toISOString(),
    JSON.stringify(response),
    JSON.stringify(result),
    result.alertLevel
  );

  return info.lastInsertRowid as number;
}

export function getCheckIns(options?: {
  floorId?: string;
  residentId?: string;
  alertLevel?: string;
  since?: Date;
  limit?: number;
}): StoredCheckIn[] {
  let query = 'SELECT * FROM checkins WHERE 1=1';
  const params: unknown[] = [];

  if (options?.floorId) {
    query += ' AND floor_id = ?';
    params.push(options.floorId);
  }

  if (options?.residentId) {
    query += ' AND resident_id = ?';
    params.push(options.residentId);
  }

  if (options?.alertLevel) {
    query += ' AND alert_level = ?';
    params.push(options.alertLevel);
  }

  if (options?.since) {
    query += ' AND timestamp >= ?';
    params.push(options.since.toISOString());
  }

  query += ' ORDER BY timestamp DESC';

  if (options?.limit) {
    query += ' LIMIT ?';
    params.push(options.limit);
  }

  const rows = db.prepare(query).all(...params) as Array<{
    id: number;
    resident_id: string;
    ra_id: string | null;
    floor_id: string;
    timestamp: string;
    responses: string;
    scores: string;
    alert_level: string;
  }>;

  return rows.map(row => ({
    ...row,
    responses: JSON.parse(row.responses),
    scores: JSON.parse(row.scores)
  }));
}

export function getResidentHistory(residentId: string, limit = 10): StoredCheckIn[] {
  return getCheckIns({ residentId, limit });
}

// ============================================================
// STATISTICS
// ============================================================

export interface FloorStats {
  floor_id: string;
  total_residents: number;
  checkins_this_week: number;
  response_rate: number;
  avg_wellbeing: number;
  red_alerts: number;
  orange_alerts: number;
  yellow_alerts: number;
}

export function getFloorStats(floorId: string): FloorStats {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const totalResidents = db.prepare(
    'SELECT COUNT(*) as count FROM residents WHERE floor_id = ?'
  ).get(floorId) as { count: number };

  const weeklyCheckins = db.prepare(`
    SELECT
      COUNT(*) as total,
      COUNT(DISTINCT resident_id) as unique_residents,
      AVG(json_extract(scores, '$.wellbeingIndex')) as avg_wellbeing,
      SUM(CASE WHEN alert_level = 'red' THEN 1 ELSE 0 END) as red,
      SUM(CASE WHEN alert_level = 'orange' THEN 1 ELSE 0 END) as orange,
      SUM(CASE WHEN alert_level = 'yellow' THEN 1 ELSE 0 END) as yellow
    FROM checkins
    WHERE floor_id = ? AND timestamp >= ?
  `).get(floorId, weekAgo.toISOString()) as {
    total: number;
    unique_residents: number;
    avg_wellbeing: number | null;
    red: number;
    orange: number;
    yellow: number;
  };

  return {
    floor_id: floorId,
    total_residents: totalResidents.count,
    checkins_this_week: weeklyCheckins.total,
    response_rate: totalResidents.count > 0
      ? weeklyCheckins.unique_residents / totalResidents.count
      : 0,
    avg_wellbeing: weeklyCheckins.avg_wellbeing || 0,
    red_alerts: weeklyCheckins.red,
    orange_alerts: weeklyCheckins.orange,
    yellow_alerts: weeklyCheckins.yellow
  };
}

// ============================================================
// EXPORT
// ============================================================

export function exportCheckInsToCSV(floorId?: string): string {
  const checkins = getCheckIns({ floorId });

  const headers = [
    'id', 'resident_id', 'floor_id', 'timestamp', 'alert_level',
    'wellbeing_index', 'phq2', 'gad2', 'ucla3', 'belonging',
    'week_rating', 'sleep_rating', 'life_satisfaction',
    'depression_flag', 'anxiety_flag', 'loneliness_flag', 'belonging_flag',
    'concerns'
  ];

  const rows = checkins.map(c => [
    c.id,
    c.resident_id,
    c.floor_id,
    c.timestamp,
    c.alert_level,
    c.scores.wellbeingIndex,
    c.scores.phq2,
    c.scores.gad2,
    c.scores.ucla3,
    c.scores.belonging,
    c.scores.weekRating,
    c.scores.sleepRating,
    c.scores.lifeSatisfaction,
    c.scores.flags.depressionScreen ? 1 : 0,
    c.scores.flags.anxietyScreen ? 1 : 0,
    c.scores.flags.highLoneliness ? 1 : 0,
    c.scores.flags.lowBelonging ? 1 : 0,
    `"${(c.responses.q14_concerns || '').replace(/"/g, '""')}"`
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

// ============================================================
// DEMO DATA
// ============================================================

export function loadDemoData(): void {
  // Create demo floor
  createFloor({ id: '3E', building: 'Main Hall', floor_number: '3E' });
  createFloor({ id: '2W', building: 'Main Hall', floor_number: '2W' });

  // Create demo RA
  createRA({ id: 'ra-smith', name: 'Jordan Smith', email: 'jsmith@university.edu' });
  assignRAToFloor('ra-smith', '3E');

  // Create demo residents
  const demoResidents: Resident[] = [
    { id: 'res-001', name: 'Alex Johnson', room: '301', floor_id: '3E' },
    { id: 'res-002', name: 'Sam Williams', room: '302', floor_id: '3E' },
    { id: 'res-003', name: 'Jordan Lee', room: '303', floor_id: '3E' },
    { id: 'res-004', name: 'Taylor Brown', room: '304', floor_id: '3E' },
    { id: 'res-005', name: 'Casey Davis', room: '305', floor_id: '3E' },
    { id: 'res-006', name: 'Morgan Miller', room: '306', floor_id: '3E' },
    { id: 'res-007', name: 'Riley Wilson', room: '307', floor_id: '3E' },
    { id: 'res-008', name: 'Avery Moore', room: '308', floor_id: '3E' },
  ];

  bulkCreateResidents(demoResidents);

  console.log('[DB] Demo data loaded: 2 floors, 1 RA, 8 residents');
}

// Initialize on import
try {
  // Ensure data directory exists
  const dataDir = path.dirname(dbPath);
  const fs = await import('fs');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  initDatabase();
} catch (e) {
  console.error('[DB] Failed to initialize:', e);
}

export { db };
