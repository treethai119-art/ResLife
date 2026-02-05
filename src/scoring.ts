/**
 * CheckIn Scoring Engine
 * Implements validated psychometric scoring from PHQ-4, UCLA-3, and Belonging scales
 */

// Response types matching survey structure
export interface CheckInResponse {
  residentId: string;
  raId: string;
  timestamp: Date;
  floor: string;

  // PHQ-2 (Depression): 0-3 scale
  q1_interest: number;      // Little interest or pleasure in doing things
  q2_depressed: number;     // Feeling down, depressed, or hopeless

  // GAD-2 (Anxiety): 0-3 scale
  q3_anxious: number;       // Feeling nervous, anxious, or on edge
  q4_worry: number;         // Not being able to stop or control worrying

  // Single items: 1-5 scale
  q5_week: number;          // How has your week been overall?
  q6_sleep: number;         // How well have you been sleeping?
  q7_lifeSat: number;       // Life satisfaction (1-10 scale)

  // UCLA-3 (Loneliness): 1-3 scale (1=Hardly ever, 2=Some, 3=Often)
  q8_companionship: number; // Lack companionship
  q9_leftOut: number;       // Feel left out
  q10_isolated: number;     // Feel isolated

  // Belonging: 1-5 scale
  q11_belong: number;       // Feel like I belong here
  q12_fitIn: number;        // Feel like I fit in
  q13_community: number;    // Feel part of the community

  // Open-ended
  q14_concerns?: string;    // Anything you want to share?

  // Activity (optional)
  q15_activities?: string[];
  q16_engagementHours?: number;
  q17_barriers?: string[];
}

export interface ScoringResult {
  // Subscale scores
  phq2: number;           // 0-6: Depression
  gad2: number;           // 0-6: Anxiety
  phq4: number;           // 0-12: Combined
  ucla3: number;          // 3-9: Loneliness
  belonging: number;      // 1-5: Mean belonging
  weekRating: number;     // 1-5: Week quality
  sleepRating: number;    // 1-5: Sleep quality
  lifeSatisfaction: number; // 1-10: Life satisfaction

  // Composite index (0-100)
  wellbeingIndex: number;

  // Clinical flags
  flags: ClinicalFlags;

  // Alert level
  alertLevel: 'none' | 'yellow' | 'orange' | 'red';
  alertReasons: string[];
}

export interface ClinicalFlags {
  depressionScreen: boolean;    // PHQ-2 >= 3
  anxietyScreen: boolean;       // GAD-2 >= 3
  highLoneliness: boolean;      // UCLA-3 >= 7
  lowBelonging: boolean;        // Belonging < 2.5
  poorSleep: boolean;           // Sleep <= 2
  lowLifeSat: boolean;          // Life sat < 5
  crisisKeywords: boolean;      // Direct crisis keywords detected
  concernKeywords: boolean;     // Indirect concern keywords detected
  needsFollowUp: boolean;       // Any flag triggered
}

// Crisis detection keywords
const DIRECT_CRISIS_KEYWORDS = [
  'suicide', 'suicidal', 'kill myself', 'end my life', 'want to die',
  'self-harm', 'cutting', 'hurt myself', 'end it all'
];

const INDIRECT_CONCERN_KEYWORDS = [
  'hopeless', 'worthless', 'no point', 'give up', "can't go on",
  'burden', 'better off without me', 'nothing matters'
];

/**
 * Score a check-in response and generate clinical flags
 */
export function scoreCheckIn(response: CheckInResponse): ScoringResult {
  // Subscale calculations
  const phq2 = response.q1_interest + response.q2_depressed;
  const gad2 = response.q3_anxious + response.q4_worry;
  const phq4 = phq2 + gad2;
  const ucla3 = response.q8_companionship + response.q9_leftOut + response.q10_isolated;
  const belonging = (response.q11_belong + response.q12_fitIn + response.q13_community) / 3;

  // Clinical flags
  const depressionScreen = phq2 >= 3;
  const anxietyScreen = gad2 >= 3;
  const highLoneliness = ucla3 >= 7;
  const lowBelonging = belonging < 2.5;
  const poorSleep = response.q6_sleep <= 2;
  const lowLifeSat = response.q7_lifeSat < 5;

  // Text analysis for crisis keywords
  const concernText = (response.q14_concerns || '').toLowerCase();
  const crisisKeywords = DIRECT_CRISIS_KEYWORDS.some(kw => concernText.includes(kw));
  const concernKeywords = INDIRECT_CONCERN_KEYWORDS.some(kw => concernText.includes(kw));

  const flags: ClinicalFlags = {
    depressionScreen,
    anxietyScreen,
    highLoneliness,
    lowBelonging,
    poorSleep,
    lowLifeSat,
    crisisKeywords,
    concernKeywords,
    needsFollowUp: depressionScreen || anxietyScreen || highLoneliness ||
                   lowBelonging || crisisKeywords || concernKeywords
  };

  // Composite wellbeing index (0-100)
  const weights = {
    depression: 0.20,
    anxiety: 0.15,
    social: 0.20,
    belong: 0.15,
    mood: 0.10,
    sleep: 0.10,
    satisfaction: 0.10
  };

  // Normalize each component to 0-1 (higher = better)
  const depressionNorm = 1 - (phq2 / 6);
  const anxietyNorm = 1 - (gad2 / 6);
  const socialNorm = 1 - ((ucla3 - 3) / 6);  // UCLA: 3-9 → 0-6
  const belongNorm = (belonging - 1) / 4;     // Belonging: 1-5 → 0-4
  const moodNorm = (response.q5_week - 1) / 4;
  const sleepNorm = (response.q6_sleep - 1) / 4;
  const satisfactionNorm = (response.q7_lifeSat - 1) / 9;

  const wellbeingIndex = Math.round(100 * (
    weights.depression * depressionNorm +
    weights.anxiety * anxietyNorm +
    weights.social * socialNorm +
    weights.belong * belongNorm +
    weights.mood * moodNorm +
    weights.sleep * sleepNorm +
    weights.satisfaction * satisfactionNorm
  ));

  // Determine alert level
  const alertReasons: string[] = [];
  let alertLevel: 'none' | 'yellow' | 'orange' | 'red' = 'none';

  if (crisisKeywords) {
    alertLevel = 'red';
    alertReasons.push('Crisis keywords detected in open response');
  }

  if (phq4 >= 9) {
    alertLevel = 'red';
    alertReasons.push('Severe distress (PHQ-4 >= 9)');
  }

  if (alertLevel !== 'red') {
    const flagCount = [depressionScreen, anxietyScreen, highLoneliness, lowBelonging].filter(Boolean).length;

    if (flagCount >= 2 || concernKeywords) {
      alertLevel = 'orange';
      if (depressionScreen) alertReasons.push('Positive depression screen');
      if (anxietyScreen) alertReasons.push('Positive anxiety screen');
      if (highLoneliness) alertReasons.push('High loneliness');
      if (lowBelonging) alertReasons.push('Low belonging');
      if (concernKeywords) alertReasons.push('Concern keywords detected');
    } else if (flagCount === 1 || poorSleep || lowLifeSat) {
      alertLevel = 'yellow';
      if (depressionScreen) alertReasons.push('Positive depression screen');
      if (anxietyScreen) alertReasons.push('Positive anxiety screen');
      if (highLoneliness) alertReasons.push('High loneliness');
      if (lowBelonging) alertReasons.push('Low belonging');
      if (poorSleep) alertReasons.push('Poor sleep quality');
      if (lowLifeSat) alertReasons.push('Low life satisfaction');
    }
  }

  return {
    phq2,
    gad2,
    phq4,
    ucla3,
    belonging: Math.round(belonging * 100) / 100,
    weekRating: response.q5_week,
    sleepRating: response.q6_sleep,
    lifeSatisfaction: response.q7_lifeSat,
    wellbeingIndex,
    flags,
    alertLevel,
    alertReasons
  };
}

/**
 * Calculate floor-level aggregate statistics
 */
export interface FloorStats {
  floor: string;
  totalResidents: number;
  completedCheckins: number;
  responseRate: number;
  avgWellbeingIndex: number;
  avgPHQ2: number;
  avgGAD2: number;
  avgUCLA3: number;
  avgBelonging: number;
  redAlerts: number;
  orangeAlerts: number;
  yellowAlerts: number;
}

export function calculateFloorStats(responses: CheckInResponse[], floor: string): FloorStats {
  const floorResponses = responses.filter(r => r.floor === floor);
  const results = floorResponses.map(scoreCheckIn);

  if (results.length === 0) {
    return {
      floor,
      totalResidents: 0,
      completedCheckins: 0,
      responseRate: 0,
      avgWellbeingIndex: 0,
      avgPHQ2: 0,
      avgGAD2: 0,
      avgUCLA3: 0,
      avgBelonging: 0,
      redAlerts: 0,
      orangeAlerts: 0,
      yellowAlerts: 0
    };
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  return {
    floor,
    totalResidents: floorResponses.length, // Simplified: assume all responded
    completedCheckins: floorResponses.length,
    responseRate: 1.0,
    avgWellbeingIndex: Math.round(avg(results.map(r => r.wellbeingIndex))),
    avgPHQ2: Math.round(avg(results.map(r => r.phq2)) * 10) / 10,
    avgGAD2: Math.round(avg(results.map(r => r.gad2)) * 10) / 10,
    avgUCLA3: Math.round(avg(results.map(r => r.ucla3)) * 10) / 10,
    avgBelonging: Math.round(avg(results.map(r => r.belonging)) * 100) / 100,
    redAlerts: results.filter(r => r.alertLevel === 'red').length,
    orangeAlerts: results.filter(r => r.alertLevel === 'orange').length,
    yellowAlerts: results.filter(r => r.alertLevel === 'yellow').length
  };
}
