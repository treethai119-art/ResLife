/**
 * CheckIn Demo
 * Demonstrates the scoring engine with sample data
 */

import { scoreCheckIn, type CheckInResponse } from './scoring.ts';

console.log(`
╔═══════════════════════════════════════════════════════════╗
║           CheckIn Scoring Engine Demo                     ║
╚═══════════════════════════════════════════════════════════╝
`);

// Test cases representing different wellbeing profiles
const testCases: { name: string; response: Omit<CheckInResponse, 'timestamp'> }[] = [
  {
    name: "Healthy Student",
    response: {
      residentId: "healthy-001",
      raId: "ra-smith",
      floor: "3E",
      q1_interest: 0, q2_depressed: 0,     // PHQ-2: 0
      q3_anxious: 0, q4_worry: 0,          // GAD-2: 0
      q5_week: 5, q6_sleep: 5, q7_lifeSat: 9,
      q8_companionship: 1, q9_leftOut: 1, q10_isolated: 1,  // UCLA-3: 3
      q11_belong: 5, q12_fitIn: 5, q13_community: 5,        // Belonging: 5
      q14_concerns: "Having a great semester!"
    }
  },
  {
    name: "Mild Anxiety",
    response: {
      residentId: "mild-anxiety-002",
      raId: "ra-smith",
      floor: "3E",
      q1_interest: 0, q2_depressed: 1,     // PHQ-2: 1
      q3_anxious: 2, q4_worry: 2,          // GAD-2: 4 (positive screen)
      q5_week: 3, q6_sleep: 3, q7_lifeSat: 6,
      q8_companionship: 2, q9_leftOut: 1, q10_isolated: 1,  // UCLA-3: 4
      q11_belong: 4, q12_fitIn: 3, q13_community: 4,
      q14_concerns: "Midterms are stressing me out."
    }
  },
  {
    name: "Depression + Loneliness",
    response: {
      residentId: "dep-lonely-003",
      raId: "ra-smith",
      floor: "3E",
      q1_interest: 2, q2_depressed: 2,     // PHQ-2: 4 (positive screen)
      q3_anxious: 1, q4_worry: 1,          // GAD-2: 2
      q5_week: 2, q6_sleep: 2, q7_lifeSat: 4,
      q8_companionship: 3, q9_leftOut: 3, q10_isolated: 2,  // UCLA-3: 8 (high)
      q11_belong: 2, q12_fitIn: 2, q13_community: 2,        // Belonging: 2 (low)
      q14_concerns: "I don't really have friends here."
    }
  },
  {
    name: "Crisis Keywords",
    response: {
      residentId: "crisis-004",
      raId: "ra-smith",
      floor: "3E",
      q1_interest: 3, q2_depressed: 3,     // PHQ-2: 6 (severe)
      q3_anxious: 2, q4_worry: 2,          // GAD-2: 4
      q5_week: 1, q6_sleep: 1, q7_lifeSat: 2,
      q8_companionship: 3, q9_leftOut: 3, q10_isolated: 3,  // UCLA-3: 9
      q11_belong: 1, q12_fitIn: 1, q13_community: 1,
      q14_concerns: "I feel so hopeless, like there's no point in going on."
    }
  },
  {
    name: "Poor Sleep Only",
    response: {
      residentId: "sleep-005",
      raId: "ra-smith",
      floor: "3E",
      q1_interest: 0, q2_depressed: 0,     // PHQ-2: 0
      q3_anxious: 1, q4_worry: 0,          // GAD-2: 1
      q5_week: 3, q6_sleep: 1, q7_lifeSat: 7,  // Sleep: 1 (poor)
      q8_companionship: 1, q9_leftOut: 1, q10_isolated: 1,
      q11_belong: 4, q12_fitIn: 4, q13_community: 4,
      q14_concerns: "My roommate stays up really late."
    }
  }
];

// Run each test case
for (const testCase of testCases) {
  const response: CheckInResponse = {
    ...testCase.response,
    timestamp: new Date()
  };

  const result = scoreCheckIn(response);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`\n📋 ${testCase.name.toUpperCase()}`);
  console.log(`   Resident: ${response.residentId}`);
  console.log(`\n   Subscale Scores:`);
  console.log(`   ├─ PHQ-2 (Depression): ${result.phq2}/6 ${result.flags.depressionScreen ? '⚠️' : '✓'}`);
  console.log(`   ├─ GAD-2 (Anxiety):    ${result.gad2}/6 ${result.flags.anxietyScreen ? '⚠️' : '✓'}`);
  console.log(`   ├─ UCLA-3 (Loneliness): ${result.ucla3}/9 ${result.flags.highLoneliness ? '⚠️' : '✓'}`);
  console.log(`   ├─ Belonging:          ${result.belonging}/5 ${result.flags.lowBelonging ? '⚠️' : '✓'}`);
  console.log(`   ├─ Week Rating:        ${result.weekRating}/5`);
  console.log(`   ├─ Sleep:              ${result.sleepRating}/5 ${result.flags.poorSleep ? '⚠️' : '✓'}`);
  console.log(`   └─ Life Satisfaction:  ${result.lifeSatisfaction}/10 ${result.flags.lowLifeSat ? '⚠️' : '✓'}`);

  console.log(`\n   Composite Wellbeing Index: ${result.wellbeingIndex}/100`);

  const alertEmoji = {
    none: '🟢',
    yellow: '🟡',
    orange: '🟠',
    red: '🔴'
  };

  console.log(`\n   Alert Level: ${alertEmoji[result.alertLevel]} ${result.alertLevel.toUpperCase()}`);

  if (result.alertReasons.length > 0) {
    console.log(`   Reasons:`);
    for (const reason of result.alertReasons) {
      console.log(`   • ${reason}`);
    }
  }

  if (result.flags.crisisKeywords) {
    console.log(`\n   ⚠️  CRISIS KEYWORDS DETECTED - Immediate follow-up required`);
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`\nDemo complete. Run 'npm run dev' to start the web server.`);
console.log(`\n`);
