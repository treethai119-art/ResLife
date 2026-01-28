# CheckIn Implementation Roadmap

## Current State (Completed)
- [x] Scoring engine with PHQ-4, UCLA-3, Belonging scales
- [x] Clinical flag detection and alert levels
- [x] Check-in form (mobile-friendly)
- [x] RA dashboard with demo data
- [x] In-memory storage

---

## Phase 1: Data Persistence (Priority: CRITICAL) ✅ COMPLETE
**Goal:** Replace in-memory storage with SQLite so data survives restarts

### Tasks
- [x] Add `better-sqlite3` dependency
- [x] Create database schema:
  - `residents` table (id, name, room, floor, ra_id)
  - `checkins` table (id, resident_id, timestamp, raw_responses JSON, scores JSON, alert_level)
  - `alerts_log` table (id, checkin_id, acknowledged, acknowledged_by, notes)
- [x] Create `src/db.ts` with CRUD operations
- [x] Migrate server.ts from array to database calls
- [x] Add data export endpoint (CSV for Google Sheets compatibility)

### Acceptance Criteria
- [x] Server restart preserves all check-in data
- [x] Can query historical check-ins per resident
- [x] Export to CSV works

---

## Phase 2: Multi-Floor Architecture (Priority: HIGH)
**Goal:** Support multiple floors, buildings, RAs

### Tasks
- [ ] Add `floors` table (id, building, floor_number, ra_ids[])
- [ ] Add `ras` table (id, name, email, floors[])
- [ ] Update check-in form to accept floor/resident params via URL
- [ ] Update dashboard to filter by floor
- [ ] Add floor selector dropdown to dashboard
- [ ] Aggregate stats per floor and per building

### Acceptance Criteria
- Dashboard shows "Floor 3E" vs "Floor 2W" separately
- Each RA sees only their assigned floors
- Building-level rollup statistics

---

## Phase 3: Resident Management (Priority: HIGH)
**Goal:** Track residents, not just anonymous check-ins

### Tasks
- [ ] Create resident roster upload (CSV: name, room, floor)
- [ ] Link check-ins to resident records
- [ ] Show resident name instead of ID on dashboard
- [ ] Track response rate (checked-in vs total residents)
- [ ] Add "last check-in" timestamp per resident
- [ ] Highlight residents who haven't checked in recently

### Acceptance Criteria
- Upload CSV of 50 residents, see them in dashboard
- Know which residents haven't responded this week
- Response rate calculation is accurate

---

## Phase 4: Longitudinal Tracking (Priority: MEDIUM)
**Goal:** Track individual trajectories over time

### Tasks
- [ ] Store multiple check-ins per resident with timestamps
- [ ] Add trajectory calculation to scoring.ts:
  - Trend (improving/stable/declining)
  - Significant decline detection (>15 points)
  - Chronic low detection (3+ consecutive <50)
- [ ] Add sparkline/mini-chart to dashboard showing history
- [ ] Add "trajectory alert" flag for declining residents
- [ ] Detail view shows full history with chart

### Acceptance Criteria
- Resident with 3 check-ins shows trend line
- Declining residents get flagged even if current score is moderate
- Can see "Week 1: 72, Week 2: 65, Week 3: 48" history

---

## Phase 5: Authentication (Priority: MEDIUM)
**Goal:** Secure access, RA-specific views

### Tasks
- [ ] Add simple PIN-based auth for RAs (no full auth system yet)
- [ ] Store RA PINs hashed in database
- [ ] Add login page for dashboard
- [ ] Session management (cookie-based)
- [ ] Filter dashboard to show only RA's assigned floors
- [ ] Audit log: who viewed what resident data

### Acceptance Criteria
- RA enters PIN, sees only their floors
- Unauthorized access returns 401
- Audit log shows "RA Smith viewed Resident 003 at 2pm"

---

## Phase 6: Notifications (Priority: LOW)
**Goal:** Alert RAs when urgent check-ins come in

### Tasks
- [ ] Add email field to RA records
- [ ] Integrate Nodemailer for email sending
- [ ] Send email on RED alert check-ins immediately
- [ ] Daily digest email for ORANGE/YELLOW alerts
- [ ] Add notification preferences (email on/off, digest frequency)

### Acceptance Criteria
- RED alert triggers email within 1 minute
- Daily digest sent at 8am with overnight alerts
- RA can disable notifications

---

## Phase 7: Topology Integration (Priority: RESEARCH)
**Goal:** Connect wellbeing data to community graph

### Tasks
- [ ] Add activity survey questions to form (or separate form)
- [ ] Build edge creation logic:
  - Shared class → edge weight +2.0
  - Shared club → edge weight +1.5
  - Same floor → edge weight +0.5
- [ ] Port homology calculations from C++ header to TypeScript (simplified)
- [ ] Calculate per-resident metrics:
  - Degree (number of connections)
  - Boundary score (edge of community)
  - Bridge score (connects subcommunities)
- [ ] Correlate topology position with wellbeing scores
- [ ] Add "structurally isolated" flag

### Acceptance Criteria
- Can visualize floor as network graph
- Boundary residents identified automatically
- Correlation between isolation and loneliness is measurable

---

## Implementation Order

```
Week 1: Phase 1 (Persistence) + Phase 3 (Residents)
        └── Core functionality, real data storage

Week 2: Phase 2 (Multi-Floor) + Phase 4 (Longitudinal)
        └── Scale to real deployment, track over time

Week 3: Phase 5 (Auth) + Phase 6 (Notifications)
        └── Security and alerting

Week 4+: Phase 7 (Topology)
         └── Research features, novel contribution
```

---

## Next Immediate Action

Start Phase 1: Add SQLite persistence

```bash
npm install better-sqlite3 @types/better-sqlite3
```

Then create `src/db.ts` with schema and migrations.
