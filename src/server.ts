/**
 * CheckIn Server
 * Express server with API endpoints for check-in form and dashboard
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { scoreCheckIn, type CheckInResponse } from './scoring.ts';
import * as db from './db.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ============================================================
// CHECK-IN API
// ============================================================

// Submit a check-in
app.post('/api/checkin', (req, res) => {
  try {
    const response: CheckInResponse = {
      ...req.body,
      timestamp: new Date()
    };

    const result = scoreCheckIn(response);
    const id = db.saveCheckIn(response, result);

    // Log alerts for demo purposes
    if (result.alertLevel !== 'none') {
      console.log(`\n[ALERT - ${result.alertLevel.toUpperCase()}] ${response.residentId}`);
      console.log(`  Wellbeing Index: ${result.wellbeingIndex}`);
      console.log(`  Reasons: ${result.alertReasons.join(', ')}`);
    }

    res.json({
      success: true,
      id,
      wellbeingIndex: result.wellbeingIndex,
      alertLevel: result.alertLevel
    });
  } catch (error) {
    console.error('Error processing check-in:', error);
    res.status(400).json({ error: 'Invalid check-in data' });
  }
});

// Get all check-ins (for dashboard)
app.get('/api/checkins', (req, res) => {
  const floorId = req.query.floor as string | undefined;
  const alertLevel = req.query.alert as string | undefined;

  const checkins = db.getCheckIns({ floorId, alertLevel });

  // Transform to match dashboard expected format
  const transformed = checkins.map(c => ({
    response: c.responses,
    result: c.scores
  }));

  res.json(transformed);
});

// Get single resident's check-in history
app.get('/api/checkins/resident/:residentId', (req, res) => {
  const history = db.getResidentHistory(req.params.residentId);
  res.json(history);
});

// ============================================================
// FLOOR & STATS API
// ============================================================

// Get all floors
app.get('/api/floors', (req, res) => {
  res.json(db.getFloors());
});

// Get floor statistics
app.get('/api/stats/:floor', (req, res) => {
  const stats = db.getFloorStats(req.params.floor);
  res.json(stats);
});

// ============================================================
// RESIDENT API
// ============================================================

// Get all residents (optionally filter by floor)
app.get('/api/residents', (req, res) => {
  const floorId = req.query.floor as string | undefined;
  res.json(db.getResidents(floorId));
});

// Get single resident
app.get('/api/residents/:id', (req, res) => {
  const resident = db.getResident(req.params.id);
  if (!resident) {
    return res.status(404).json({ error: 'Resident not found' });
  }
  res.json(resident);
});

// Create/update resident
app.post('/api/residents', (req, res) => {
  try {
    db.createResident(req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: 'Invalid resident data' });
  }
});

// Bulk upload residents (CSV format expected as JSON array)
app.post('/api/residents/bulk', (req, res) => {
  try {
    const count = db.bulkCreateResidents(req.body);
    res.json({ success: true, count });
  } catch (error) {
    res.status(400).json({ error: 'Invalid bulk data' });
  }
});

// ============================================================
// EXPORT API
// ============================================================

// Export check-ins to CSV
app.get('/api/export/csv', (req, res) => {
  const floorId = req.query.floor as string | undefined;
  const csv = db.exportCheckInsToCSV(floorId);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=checkins.csv');
  res.send(csv);
});

// ============================================================
// DEMO DATA
// ============================================================

app.post('/api/demo', (req, res) => {
  // Load demo floor and residents structure
  db.loadDemoData();

  // Generate sample check-ins with varied wellbeing profiles
  const demoCheckIns = [
    // Red alert - crisis keywords
    {
      residentId: 'res-001',
      raId: 'ra-smith',
      floor: '3E',
      q1_interest: 3, q2_depressed: 3, q3_anxious: 2, q4_worry: 2,
      q5_week: 1, q6_sleep: 1, q7_lifeSat: 2,
      q8_companionship: 3, q9_leftOut: 3, q10_isolated: 3,
      q11_belong: 1, q12_fitIn: 1, q13_community: 1,
      q14_concerns: "I feel so hopeless lately, nothing seems to matter anymore."
    },
    // Orange alert - multiple flags
    {
      residentId: 'res-002',
      raId: 'ra-smith',
      floor: '3E',
      q1_interest: 2, q2_depressed: 2, q3_anxious: 3, q4_worry: 3,
      q5_week: 2, q6_sleep: 2, q7_lifeSat: 4,
      q8_companionship: 2, q9_leftOut: 3, q10_isolated: 2,
      q11_belong: 2, q12_fitIn: 2, q13_community: 2,
      q14_concerns: "Midterms are really stressing me out."
    },
    // Yellow alert - single flag
    {
      residentId: 'res-003',
      raId: 'ra-smith',
      floor: '3E',
      q1_interest: 1, q2_depressed: 2, q3_anxious: 1, q4_worry: 1,
      q5_week: 3, q6_sleep: 2, q7_lifeSat: 5,
      q8_companionship: 2, q9_leftOut: 2, q10_isolated: 1,
      q11_belong: 3, q12_fitIn: 3, q13_community: 3,
      q14_concerns: ""
    },
    // Healthy
    {
      residentId: 'res-004',
      raId: 'ra-smith',
      floor: '3E',
      q1_interest: 0, q2_depressed: 0, q3_anxious: 0, q4_worry: 0,
      q5_week: 5, q6_sleep: 5, q7_lifeSat: 9,
      q8_companionship: 1, q9_leftOut: 1, q10_isolated: 1,
      q11_belong: 5, q12_fitIn: 5, q13_community: 5,
      q14_concerns: "Having a great semester so far!"
    },
    // Healthy
    {
      residentId: 'res-005',
      raId: 'ra-smith',
      floor: '3E',
      q1_interest: 0, q2_depressed: 1, q3_anxious: 1, q4_worry: 0,
      q5_week: 4, q6_sleep: 4, q7_lifeSat: 7,
      q8_companionship: 1, q9_leftOut: 1, q10_isolated: 1,
      q11_belong: 4, q12_fitIn: 4, q13_community: 4,
      q14_concerns: ""
    },
    // Yellow - poor sleep
    {
      residentId: 'res-006',
      raId: 'ra-smith',
      floor: '3E',
      q1_interest: 1, q2_depressed: 0, q3_anxious: 1, q4_worry: 1,
      q5_week: 3, q6_sleep: 1, q7_lifeSat: 6,
      q8_companionship: 1, q9_leftOut: 1, q10_isolated: 1,
      q11_belong: 4, q12_fitIn: 3, q13_community: 4,
      q14_concerns: "My roommate snores really loud."
    },
    // Orange - lonely + low belonging
    {
      residentId: 'res-007',
      raId: 'ra-smith',
      floor: '3E',
      q1_interest: 1, q2_depressed: 1, q3_anxious: 0, q4_worry: 0,
      q5_week: 2, q6_sleep: 3, q7_lifeSat: 4,
      q8_companionship: 3, q9_leftOut: 3, q10_isolated: 2,
      q11_belong: 2, q12_fitIn: 2, q13_community: 1,
      q14_concerns: "I'm still trying to find my people here."
    },
    // Healthy
    {
      residentId: 'res-008',
      raId: 'ra-smith',
      floor: '3E',
      q1_interest: 0, q2_depressed: 0, q3_anxious: 1, q4_worry: 1,
      q5_week: 4, q6_sleep: 4, q7_lifeSat: 8,
      q8_companionship: 1, q9_leftOut: 1, q10_isolated: 1,
      q11_belong: 5, q12_fitIn: 4, q13_community: 5,
      q14_concerns: ""
    }
  ];

  // Save all demo check-ins
  let redCount = 0, orangeCount = 0, yellowCount = 0;

  for (const data of demoCheckIns) {
    const response: CheckInResponse = {
      ...data,
      timestamp: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000)
    };
    const result = scoreCheckIn(response);
    db.saveCheckIn(response, result);

    if (result.alertLevel === 'red') redCount++;
    if (result.alertLevel === 'orange') orangeCount++;
    if (result.alertLevel === 'yellow') yellowCount++;
  }

  console.log(`\n[DEMO] Loaded ${demoCheckIns.length} check-ins`);
  console.log(`  Red: ${redCount}, Orange: ${orangeCount}, Yellow: ${yellowCount}`);

  res.json({ success: true, count: demoCheckIns.length });
});

// ============================================================
// PAGE ROUTES
// ============================================================

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║   CheckIn Server v0.2.0 (with SQLite persistence)         ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║   Form:      http://localhost:${PORT}/                       ║
║   Dashboard: http://localhost:${PORT}/dashboard              ║
║                                                           ║
║   API Endpoints:                                          ║
║   POST /api/checkin      - Submit a check-in              ║
║   GET  /api/checkins     - Get all check-ins              ║
║   GET  /api/residents    - Get residents                  ║
║   GET  /api/floors       - Get floors                     ║
║   GET  /api/stats/:floor - Get floor statistics           ║
║   GET  /api/export/csv   - Export to CSV                  ║
║   POST /api/demo         - Load demo data                 ║
║                                                           ║
║   Database: data/checkin.db                               ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
