/**
 * CheckIn Server
 * Express server with API endpoints for check-in form and dashboard
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { scoreCheckIn, type CheckInResponse, type ScoringResult } from './scoring.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory storage (replace with database in production)
interface StoredCheckIn {
  response: CheckInResponse;
  result: ScoringResult;
}
const checkIns: StoredCheckIn[] = [];

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// API Routes

// Submit a check-in
app.post('/api/checkin', (req, res) => {
  try {
    const response: CheckInResponse = {
      ...req.body,
      timestamp: new Date()
    };

    const result = scoreCheckIn(response);

    checkIns.push({ response, result });

    // Log alerts for demo purposes
    if (result.alertLevel !== 'none') {
      console.log(`\n[ALERT - ${result.alertLevel.toUpperCase()}] ${response.residentId}`);
      console.log(`  Wellbeing Index: ${result.wellbeingIndex}`);
      console.log(`  Reasons: ${result.alertReasons.join(', ')}`);
    }

    res.json({
      success: true,
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
  res.json(checkIns);
});

// Get floor statistics
app.get('/api/stats/:floor', (req, res) => {
  const floorData = checkIns.filter(c => c.response.floor === req.params.floor);

  if (floorData.length === 0) {
    return res.json({ floor: req.params.floor, count: 0 });
  }

  const results = floorData.map(c => c.result);
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  res.json({
    floor: req.params.floor,
    count: floorData.length,
    avgWellbeingIndex: Math.round(avg(results.map(r => r.wellbeingIndex))),
    avgPHQ2: Math.round(avg(results.map(r => r.phq2)) * 10) / 10,
    avgGAD2: Math.round(avg(results.map(r => r.gad2)) * 10) / 10,
    avgUCLA3: Math.round(avg(results.map(r => r.ucla3)) * 10) / 10,
    redAlerts: results.filter(r => r.alertLevel === 'red').length,
    orangeAlerts: results.filter(r => r.alertLevel === 'orange').length,
    yellowAlerts: results.filter(r => r.alertLevel === 'yellow').length
  });
});

// Load demo data
app.post('/api/demo', (req, res) => {
  // Clear existing data
  checkIns.length = 0;

  // Generate sample residents with varied wellbeing profiles
  const demoResidents = [
    // Red alert - crisis keywords
    {
      residentId: 'resident-001',
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
      residentId: 'resident-002',
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
      residentId: 'resident-003',
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
      residentId: 'resident-004',
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
      residentId: 'resident-005',
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
      residentId: 'resident-006',
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
      residentId: 'resident-007',
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
      residentId: 'resident-008',
      raId: 'ra-smith',
      floor: '3E',
      q1_interest: 0, q2_depressed: 0, q3_anxious: 1, q4_worry: 1,
      q5_week: 4, q6_sleep: 4, q7_lifeSat: 8,
      q8_companionship: 1, q9_leftOut: 1, q10_isolated: 1,
      q11_belong: 5, q12_fitIn: 4, q13_community: 5,
      q14_concerns: ""
    }
  ];

  // Add all demo residents
  for (const resident of demoResidents) {
    const response: CheckInResponse = {
      ...resident,
      timestamp: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000) // Random time in past week
    };
    const result = scoreCheckIn(response);
    checkIns.push({ response, result });
  }

  console.log(`\nLoaded ${demoResidents.length} demo residents`);
  console.log(`  Red alerts: ${checkIns.filter(c => c.result.alertLevel === 'red').length}`);
  console.log(`  Orange alerts: ${checkIns.filter(c => c.result.alertLevel === 'orange').length}`);
  console.log(`  Yellow alerts: ${checkIns.filter(c => c.result.alertLevel === 'yellow').length}`);

  res.json({ success: true, count: demoResidents.length });
});

// Serve dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   CheckIn Server Running                                  ║
║                                                           ║
║   Form:      http://localhost:${PORT}/                       ║
║   Dashboard: http://localhost:${PORT}/dashboard              ║
║                                                           ║
║   API Endpoints:                                          ║
║   POST /api/checkin  - Submit a check-in                  ║
║   GET  /api/checkins - Get all check-ins                  ║
║   POST /api/demo     - Load demo data                     ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
