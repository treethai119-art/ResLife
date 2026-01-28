# CheckIn: Automated Resident Connection System
## Complete Technical Specification for Claude Code

---

# EXECUTIVE SUMMARY

**What this is:** A PWA that lets Residence Life staff photograph a roster, automatically text residents to find their availability, photograph class schedules, and auto-generate an optimized check-in calendar with automated reminders.

**Core principle:** The RA should spend time TALKING to residents, not CHASING them.

**No external paid APIs.** Everything runs locally or uses free services (email-to-SMS gateways, IMAP).

---

# SYSTEM ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CheckIn SYSTEM ARCHITECTURE                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   INTAKE     │     │   OUTREACH   │     │  SCHEDULING  │     │   EXECUTE    │
│   MODULE     │────▶│   MODULE     │────▶│   MODULE     │────▶│   MODULE     │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
       │                    │                    │                    │
       ▼                    ▼                    ▼                    ▼
  ┌─────────┐         ┌─────────┐         ┌─────────┐         ┌─────────┐
  │ Roster  │         │ Auto-   │         │ Calendar│         │ Check-in│
  │ OCR     │         │ Text    │         │ Builder │         │ Logger  │
  │         │         │ Engine  │         │         │         │         │
  │ Schedule│         │ Response│         │ Batch   │         │ Follow- │
  │ OCR     │         │ Parser  │         │ Optimizer│        │ up Queue│
  └─────────┘         └─────────┘         └─────────┘         └─────────┘
       │                    │                    │                    │
       └────────────────────┴────────────────────┴────────────────────┘
                                     │
                              ┌──────┴──────┐
                              │  IndexedDB  │
                              │  (Local)    │
                              └─────────────┘
```

---

# DATA MODELS

## Database Schema (IndexedDB)

```typescript
// TypeScript interfaces for data models

interface Resident {
  id: string;                    // UUID
  firstName: string;
  lastName: string;
  room: string;
  email: string;
  phone: string;
  carrier?: CarrierType;         // For email-to-SMS
  
  // Availability (parsed from their text response)
  statedAvailability?: AvailabilityBlock[];
  
  // Class schedule (parsed from OCR)
  classSchedule?: ClassBlock[];
  freeBlocks?: TimeBlock[];      // Computed inverse of classSchedule
  
  // Status tracking
  availabilityRequestSent: boolean;
  availabilityRequestSentAt?: Date;
  availabilityReceived: boolean;
  availabilityReceivedAt?: Date;
  scheduleUploaded: boolean;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  buildingId: string;
  raId: string;
}

interface ClassBlock {
  courseCode: string;            // "BIOL 101"
  courseName?: string;           // "Intro to Biology"
  days: DayCode[];               // ["M", "W", "F"]
  startTime: string;             // "09:00" (24hr)
  endTime: string;               // "09:50"
  location?: string;             // "Room 215"
}

interface TimeBlock {
  day: DayCode;
  startTime: string;             // "09:00" (24hr)
  endTime: string;               // "17:00"
}

interface AvailabilityBlock {
  days: DayCode[];
  startTime: string;
  endTime: string;
  source: 'stated' | 'inferred'; // stated = from text, inferred = from schedule gaps
}

type DayCode = 'M' | 'T' | 'W' | 'TH' | 'F' | 'SA' | 'SU';

type CarrierType = 
  | 'verizon'      // @vtext.com
  | 'att'          // @txt.att.net
  | 'tmobile'      // @tmomail.net
  | 'sprint'       // @messaging.sprintpcs.com
  | 'unknown';

interface CheckInPeriod {
  id: string;
  name: string;                  // "Fall 2026 - Mid-Semester"
  startDate: Date;
  endDate: Date;
  status: 'setup' | 'active' | 'closed';
  buildingId: string;
  raId: string;
}

interface ScheduledCheckIn {
  id: string;
  checkInPeriodId: string;
  residentId: string;
  scheduledDate: Date;
  scheduledTime: string;         // "18:00"
  
  // Batching - multiple residents same time slot
  batchId?: string;              // Groups nearby rooms together
  
  // Reminder tracking
  reminderSent: boolean;
  reminderSentAt?: Date;
  
  // Outcome
  status: 'scheduled' | 'reminded' | 'completed' | 'missed' | 'rescheduled';
  completedAt?: Date;
  notes?: string;
  followUpNeeded: boolean;
  followUpReason?: string;
}

interface CheckInResponse {
  id: string;
  residentId: string;
  checkInPeriodId: string;
  scheduledCheckInId?: string;
  
  // The actual check-in data
  timestamp: Date;
  rating: 1 | 2 | 3 | 4 | 5;
  concerns: ConcernType[];
  interests: InterestType[];
  meetingRequested: 'yes' | 'maybe' | 'no';
  freeText?: string;
  
  // RA follow-up
  followUpStatus: 'pending' | 'complete' | 'not_needed';
  followUpNotes?: string;
  followUpCompletedAt?: Date;
}

type ConcernType = 
  | 'academics'
  | 'roommate'
  | 'homesick'
  | 'social'
  | 'financial'
  | 'health'
  | 'just_chat'
  | 'all_good';

type InterestType =
  | 'study_groups'
  | 'intramurals'
  | 'gaming'
  | 'fitness'
  | 'music'
  | 'greek_life'
  | 'campus_jobs'
  | 'other';

interface Building {
  id: string;
  name: string;
  raId: string;
}

interface RA {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  buildings: string[];           // Building IDs
  
  // For email-to-SMS sending
  emailAddress: string;          // RA's email for sending
  emailPassword?: string;        // Stored securely, for IMAP access
  
  // Availability for scheduling
  availableSlots: TimeBlock[];
}

interface OutgoingMessage {
  id: string;
  residentId: string;
  messageType: 'availability_request' | 'reminder' | 'reschedule' | 'custom';
  content: string;
  scheduledFor: Date;
  status: 'pending' | 'sent' | 'failed';
  sentAt?: Date;
  sentVia: 'email_to_sms' | 'manual';
  errorMessage?: string;
}

interface IncomingMessage {
  id: string;
  residentId?: string;           // Matched after parsing
  fromPhone: string;
  fromEmail?: string;
  content: string;
  receivedAt: Date;
  parsed: boolean;
  parsedData?: {
    availabilityBlocks?: AvailabilityBlock[];
    isRescheduleRequest?: boolean;
    sentiment?: 'positive' | 'neutral' | 'negative';
  };
}

interface CommunityMatch {
  id: string;
  type: 'shared_class' | 'schedule_overlap' | 'shared_interest';
  residentIds: string[];
  details: {
    className?: string;          // For shared_class
    timeBlock?: TimeBlock;       // For schedule_overlap
    interest?: InterestType;     // For shared_interest
  };
  suggestedAction?: string;
  actionTaken: boolean;
}
```

---

# MODULE 1: INTAKE (OCR)

## 1A: Roster OCR

**Input:** Photo of roster (PNG/JPG) containing names, rooms, emails, phones

**Technology:** Tesseract.js (runs entirely in browser, no API)

**Process:**

```javascript
// Pseudo-code for roster OCR pipeline

async function processRosterImage(imageFile: File): Promise<ParsedRoster> {
  // 1. Load Tesseract
  const worker = await Tesseract.createWorker('eng');
  
  // 2. Perform OCR
  const { data: { text, blocks } } = await worker.recognize(imageFile);
  
  // 3. Parse extracted text
  const residents = parseRosterText(text);
  
  // 4. Return for review
  return {
    rawText: text,
    residents: residents,
    confidence: calculateConfidence(blocks),
    needsReview: residents.some(r => r.confidence < 0.8)
  };
}

function parseRosterText(text: string): ParsedResident[] {
  const lines = text.split('\n').filter(line => line.trim());
  const residents: ParsedResident[] = [];
  
  for (const line of lines) {
    const resident: Partial<ParsedResident> = {};
    
    // Extract email (most reliable anchor)
    const emailMatch = line.match(/[\w.-]+@[\w.-]+\.\w+/i);
    if (emailMatch) {
      resident.email = emailMatch[0].toLowerCase();
    }
    
    // Extract phone
    const phonePatterns = [
      /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,  // (843) 555-1234 or 843-555-1234
      /\d{10}/                                  // 8435551234
    ];
    for (const pattern of phonePatterns) {
      const match = line.match(pattern);
      if (match) {
        resident.phone = normalizePhone(match[0]);
        break;
      }
    }
    
    // Extract room number
    const roomPatterns = [
      /\b(\d{3}[A-Z]?)\b/,                     // 312 or 312B
      /room\s*:?\s*(\d{3}[A-Z]?)/i,            // Room: 312
      /\b(\d{1,2}[-/]\d{3})\b/                 // 3-312 (floor-room)
    ];
    for (const pattern of roomPatterns) {
      const match = line.match(pattern);
      if (match) {
        resident.room = match[1];
        break;
      }
    }
    
    // Extract name (what's left, or before email)
    if (emailMatch) {
      const beforeEmail = line.substring(0, emailMatch.index).trim();
      const nameParts = beforeEmail.replace(/[^a-zA-Z\s]/g, '').trim().split(/\s+/);
      if (nameParts.length >= 2) {
        resident.firstName = nameParts[0];
        resident.lastName = nameParts.slice(1).join(' ');
      }
    }
    
    // Only add if we have minimum viable data
    if (resident.firstName && resident.phone) {
      residents.push(resident as ParsedResident);
    }
  }
  
  return residents;
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return digits;
  }
  if (digits.length === 11 && digits[0] === '1') {
    return digits.substring(1);
  }
  return digits;
}
```

**UI Component: Roster Upload & Review**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Upload Roster                                                    [X Close] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │                    📷 Tap to take photo                            │   │
│  │                         - or -                                      │   │
│  │                    📁 Select from files                            │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  After upload, shows:                                                       │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Found 47 residents                              [Import All]       │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │  ✓ Sarah Martinez    312    sarah.m@school.edu    (843) 555-1234   │   │
│  │  ✓ Jake Thompson     315    jake.t@school.edu     (843) 555-2345   │   │
│  │  ⚠ [Unknown]         108    mike@school.edu       (843) 555-3456   │   │
│  │    └─ Click to edit name                                           │   │
│  │  ✓ Anna Kim          401    anna.k@school.edu     (843) 555-4567   │   │
│  │  ...                                                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ⚠ 3 residents need review (yellow rows)                                   │
│                                                                             │
│                                          [Cancel]  [Import 47 Residents]   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1B: Class Schedule OCR

**Input:** Photo of class schedule (screenshot from student portal, printed schedule, etc.)

**Process:**

```javascript
async function processScheduleImage(imageFile: File, residentId: string): Promise<ParsedSchedule> {
  const worker = await Tesseract.createWorker('eng');
  const { data: { text } } = await worker.recognize(imageFile);
  
  const classes = parseScheduleText(text);
  const freeBlocks = computeFreeBlocks(classes);
  
  return {
    rawText: text,
    classes: classes,
    freeBlocks: freeBlocks,
    residentId: residentId
  };
}

function parseScheduleText(text: string): ClassBlock[] {
  const classes: ClassBlock[] = [];
  const lines = text.split('\n');
  
  // Common patterns for class schedules
  const patterns = [
    // "BIOL 101  MWF 9:00-9:50am  Room 215"
    /([A-Z]{2,4}\s*\d{3}[A-Z]?)\s+((?:M|T|W|TH|F|SA|SU)+)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*(am|pm)?/gi,
    
    // "Biology 101 | Monday/Wednesday/Friday | 9:00 AM - 9:50 AM"
    /([A-Za-z]+\s*\d{3})\s*\|\s*([\w\/]+)\s*\|\s*(\d{1,2}:\d{2})\s*(AM|PM)?\s*-\s*(\d{1,2}:\d{2})\s*(AM|PM)?/gi,
  ];
  
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = pattern.exec(line);
      if (match) {
        classes.push({
          courseCode: match[1].replace(/\s+/g, ' ').trim(),
          days: parseDays(match[2]),
          startTime: normalizeTime(match[3], match[5] || match[4]),
          endTime: normalizeTime(match[4], match[6] || match[5])
        });
      }
    }
  }
  
  return classes;
}

function parseDays(dayString: string): DayCode[] {
  const days: DayCode[] = [];
  const normalized = dayString.toUpperCase();
  
  // Handle "TH" before "T" to avoid false matches
  if (normalized.includes('TH')) days.push('TH');
  if (normalized.includes('M')) days.push('M');
  if (normalized.includes('T') && !normalized.includes('TH')) days.push('T');
  if (normalized.includes('W')) days.push('W');
  if (normalized.includes('F')) days.push('F');
  if (normalized.includes('SA')) days.push('SA');
  if (normalized.includes('SU')) days.push('SU');
  
  // Handle written out days
  if (/monday/i.test(normalized)) days.push('M');
  if (/tuesday/i.test(normalized)) days.push('T');
  if (/wednesday/i.test(normalized)) days.push('W');
  if (/thursday/i.test(normalized)) days.push('TH');
  if (/friday/i.test(normalized)) days.push('F');
  
  return [...new Set(days)]; // Remove duplicates
}

function computeFreeBlocks(classes: ClassBlock[]): TimeBlock[] {
  const daySchedule: Record<DayCode, TimeBlock[]> = {
    'M': [], 'T': [], 'W': [], 'TH': [], 'F': [], 'SA': [], 'SU': []
  };
  
  // Assume available 8am - 10pm
  const dayStart = '08:00';
  const dayEnd = '22:00';
  
  // For each day, find gaps between classes
  for (const day of Object.keys(daySchedule) as DayCode[]) {
    const dayClasses = classes
      .filter(c => c.days.includes(day))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    
    if (dayClasses.length === 0) {
      // Entire day is free
      daySchedule[day] = [{ day, startTime: dayStart, endTime: dayEnd }];
      continue;
    }
    
    const freeBlocks: TimeBlock[] = [];
    
    // Gap before first class
    if (dayClasses[0].startTime > dayStart) {
      freeBlocks.push({
        day,
        startTime: dayStart,
        endTime: dayClasses[0].startTime
      });
    }
    
    // Gaps between classes
    for (let i = 0; i < dayClasses.length - 1; i++) {
      const currentEnd = dayClasses[i].endTime;
      const nextStart = dayClasses[i + 1].startTime;
      
      if (currentEnd < nextStart) {
        freeBlocks.push({
          day,
          startTime: currentEnd,
          endTime: nextStart
        });
      }
    }
    
    // Gap after last class
    const lastClass = dayClasses[dayClasses.length - 1];
    if (lastClass.endTime < dayEnd) {
      freeBlocks.push({
        day,
        startTime: lastClass.endTime,
        endTime: dayEnd
      });
    }
    
    daySchedule[day] = freeBlocks;
  }
  
  // Flatten to array
  return Object.values(daySchedule).flat();
}
```

---

# MODULE 2: OUTREACH (Auto-Text Engine)

## 2A: Email-to-SMS Gateway

**No paid API required.** Uses carrier email gateways.

```javascript
// Carrier email-to-SMS gateways
const CARRIER_GATEWAYS: Record<CarrierType, string> = {
  'verizon': '@vtext.com',
  'att': '@txt.att.net',
  'tmobile': '@tmomail.net',
  'sprint': '@messaging.sprintpcs.com',
  'unknown': '@vtext.com' // Default, may not work
};

function getEmailToSmsAddress(phone: string, carrier: CarrierType): string {
  const cleanPhone = phone.replace(/\D/g, '');
  return `${cleanPhone}${CARRIER_GATEWAYS[carrier]}`;
}

// For unknown carriers, we try multiple gateways
function getAllPossibleAddresses(phone: string): string[] {
  const cleanPhone = phone.replace(/\D/g, '');
  return Object.values(CARRIER_GATEWAYS).map(gateway => `${cleanPhone}${gateway}`);
}
```

## 2B: Message Sending Options

**Option 1: Bulk Email Composer (No backend needed)**

```javascript
function generateMailtoLink(residents: Resident[], message: string): string {
  // Generate mailto: link that opens native email client
  const bccList = residents
    .map(r => getEmailToSmsAddress(r.phone, r.carrier || 'unknown'))
    .join(',');
  
  const encodedSubject = encodeURIComponent(''); // SMS doesn't show subject
  const encodedBody = encodeURIComponent(message);
  
  return `mailto:?bcc=${bccList}&subject=${encodedSubject}&body=${encodedBody}`;
}

// Usage: window.location.href = generateMailtoLink(residents, message);
// Opens email client with all recipients in BCC
```

**Option 2: Scheduled Queue with Manual Send Assist**

```javascript
interface SendQueue {
  messages: OutgoingMessage[];
  currentIndex: number;
}

function generateSendQueue(residents: Resident[], messageTemplate: string): SendQueue {
  const messages = residents.map(r => ({
    id: generateUUID(),
    residentId: r.id,
    messageType: 'availability_request' as const,
    content: personalizeMessage(messageTemplate, r),
    scheduledFor: new Date(),
    status: 'pending' as const,
    sentVia: 'manual' as const
  }));
  
  return { messages, currentIndex: 0 };
}

function personalizeMessage(template: string, resident: Resident): string {
  return template
    .replace('[NAME]', resident.firstName)
    .replace('[ROOM]', resident.room)
    .replace('[RA_NAME]', getCurrentRA().firstName);
}

// UI shows one message at a time with "Send" button that:
// 1. Opens SMS app with pre-filled number and message
// 2. Marks as sent when user returns
// 3. Advances to next message
```

**Option 3: Native Share API (Mobile)**

```javascript
async function shareToSMS(phone: string, message: string): Promise<boolean> {
  if (navigator.share) {
    try {
      await navigator.share({
        text: message,
        url: '' // Some SMS apps need this empty
      });
      return true;
    } catch (err) {
      console.log('Share cancelled or failed');
      return false;
    }
  }
  
  // Fallback: sms: protocol
  window.location.href = `sms:${phone}?body=${encodeURIComponent(message)}`;
  return true;
}
```

## 2C: Availability Request Message

**Default Template:**

```
Hey [NAME]! 👋 I'm [RA_NAME], your RA in [BUILDING]. 

I'd love to catch up with you this semester! When's usually a good time for a quick chat?

Just reply with something like "Tuesdays after 6" or "weekday mornings" - whatever works for you!
```

## 2D: Response Parsing (Natural Language)

```javascript
function parseAvailabilityResponse(text: string): AvailabilityBlock[] {
  const blocks: AvailabilityBlock[] = [];
  const lower = text.toLowerCase();
  
  // Day patterns
  const dayPatterns: Record<string, DayCode[]> = {
    'monday': ['M'],
    'tuesday': ['T'],
    'wednesday': ['W'],
    'thursday': ['TH'],
    'friday': ['F'],
    'saturday': ['SA'],
    'sunday': ['SU'],
    'weekday': ['M', 'T', 'W', 'TH', 'F'],
    'weekend': ['SA', 'SU'],
    'mwf': ['M', 'W', 'F'],
    'tth': ['T', 'TH'],
    'tr': ['T', 'TH'],
    'everyday': ['M', 'T', 'W', 'TH', 'F', 'SA', 'SU']
  };
  
  // Time patterns
  const timePatterns: Record<string, { start: string, end: string }> = {
    'morning': { start: '08:00', end: '12:00' },
    'afternoon': { start: '12:00', end: '17:00' },
    'evening': { start: '17:00', end: '21:00' },
    'night': { start: '19:00', end: '22:00' },
    'lunch': { start: '11:00', end: '13:00' }
  };
  
  // Find days mentioned
  let foundDays: DayCode[] = [];
  for (const [pattern, days] of Object.entries(dayPatterns)) {
    if (lower.includes(pattern)) {
      foundDays = [...foundDays, ...days];
    }
  }
  foundDays = [...new Set(foundDays)]; // Dedupe
  
  // Find times mentioned
  let foundTime = { start: '08:00', end: '22:00' }; // Default: anytime
  
  // Check for time-of-day words
  for (const [pattern, time] of Object.entries(timePatterns)) {
    if (lower.includes(pattern)) {
      foundTime = time;
      break;
    }
  }
  
  // Check for "after X" pattern
  const afterMatch = lower.match(/after\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (afterMatch) {
    let hour = parseInt(afterMatch[1]);
    const isPM = afterMatch[3] === 'pm' || (hour < 7 && !afterMatch[3]); // Assume PM if small number
    if (isPM && hour < 12) hour += 12;
    foundTime = { start: `${hour.toString().padStart(2, '0')}:00`, end: '22:00' };
  }
  
  // Check for "before X" pattern
  const beforeMatch = lower.match(/before\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (beforeMatch) {
    let hour = parseInt(beforeMatch[1]);
    const isPM = beforeMatch[3] === 'pm';
    if (isPM && hour < 12) hour += 12;
    foundTime = { start: '08:00', end: `${hour.toString().padStart(2, '0')}:00` };
  }
  
  // Check for specific time like "around 7" or "at 6pm"
  const atMatch = lower.match(/(?:around|at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (atMatch) {
    let hour = parseInt(atMatch[1]);
    const isPM = atMatch[3] === 'pm' || (hour < 7 && !atMatch[3]);
    if (isPM && hour < 12) hour += 12;
    // Give a 2-hour window around the stated time
    const start = Math.max(8, hour - 1);
    const end = Math.min(22, hour + 1);
    foundTime = { 
      start: `${start.toString().padStart(2, '0')}:00`, 
      end: `${end.toString().padStart(2, '0')}:00` 
    };
  }
  
  // Build blocks
  if (foundDays.length === 0) {
    // No specific days mentioned, assume weekdays
    foundDays = ['M', 'T', 'W', 'TH', 'F'];
  }
  
  blocks.push({
    days: foundDays,
    startTime: foundTime.start,
    endTime: foundTime.end,
    source: 'stated'
  });
  
  return blocks;
}

// Examples:
// "tuesdays after 6" → [{ days: ['T'], start: '18:00', end: '22:00' }]
// "weekday mornings" → [{ days: ['M','T','W','TH','F'], start: '08:00', end: '12:00' }]
// "im free around 3pm on thursdays" → [{ days: ['TH'], start: '14:00', end: '16:00' }]
// "anytime works" → [{ days: ['M','T','W','TH','F'], start: '08:00', end: '22:00' }]
```

---

# MODULE 3: SCHEDULING ENGINE

## 3A: Calendar Builder

```javascript
interface SchedulingConfig {
  checkInDurationMinutes: number;  // How long each check-in takes (default: 15)
  maxCheckInsPerSlot: number;      // Batch nearby rooms (default: 3)
  preferredHours: { start: string, end: string }; // e.g., 17:00-21:00
  avoidWeekends: boolean;
  raAvailability: TimeBlock[];
}

interface ScheduledSlot {
  date: Date;
  time: string;
  residents: Resident[];
  batchScore: number; // Higher = better (nearby rooms, shared availability)
}

function buildSchedule(
  residents: Resident[],
  period: CheckInPeriod,
  config: SchedulingConfig
): ScheduledSlot[] {
  const slots: ScheduledSlot[] = [];
  const unscheduled = [...residents];
  
  // Get all possible time slots in the period
  const possibleSlots = generateTimeSlots(period, config);
  
  for (const slot of possibleSlots) {
    if (unscheduled.length === 0) break;
    
    // Find residents available at this slot
    const available = unscheduled.filter(r => 
      isResidentAvailable(r, slot, config)
    );
    
    if (available.length === 0) continue;
    
    // Score and select best candidates for this slot (batch nearby rooms)
    const batch = selectBatch(available, config.maxCheckInsPerSlot);
    
    if (batch.length > 0) {
      slots.push({
        date: slot.date,
        time: slot.time,
        residents: batch,
        batchScore: calculateBatchScore(batch)
      });
      
      // Remove scheduled residents from unscheduled list
      batch.forEach(r => {
        const idx = unscheduled.findIndex(u => u.id === r.id);
        if (idx >= 0) unscheduled.splice(idx, 1);
      });
    }
  }
  
  return slots;
}

function isResidentAvailable(
  resident: Resident, 
  slot: { date: Date, time: string },
  config: SchedulingConfig
): boolean {
  const dayCode = getDayCode(slot.date);
  
  // Check stated availability
  if (resident.statedAvailability) {
    const stated = resident.statedAvailability.find(a => 
      a.days.includes(dayCode) &&
      slot.time >= a.startTime &&
      slot.time <= a.endTime
    );
    if (!stated) return false;
  }
  
  // Check class schedule (must be in free block)
  if (resident.freeBlocks) {
    const free = resident.freeBlocks.find(f =>
      f.day === dayCode &&
      slot.time >= f.startTime &&
      slot.time <= f.endTime
    );
    if (!free) return false;
  }
  
  // Check RA availability
  const raFree = config.raAvailability.find(a =>
    a.day === dayCode &&
    slot.time >= a.startTime &&
    slot.time <= a.endTime
  );
  if (!raFree) return false;
  
  return true;
}

function selectBatch(available: Resident[], maxSize: number): Resident[] {
  if (available.length <= maxSize) return available;
  
  // Sort by room number to batch nearby rooms
  const sorted = [...available].sort((a, b) => {
    const roomA = parseInt(a.room.replace(/\D/g, ''));
    const roomB = parseInt(b.room.replace(/\D/g, ''));
    return roomA - roomB;
  });
  
  // Take first N (nearby rooms)
  return sorted.slice(0, maxSize);
}

function calculateBatchScore(residents: Resident[]): number {
  let score = 0;
  
  // Bonus for nearby room numbers
  const rooms = residents.map(r => parseInt(r.room.replace(/\D/g, '')));
  const roomSpread = Math.max(...rooms) - Math.min(...rooms);
  score += Math.max(0, 20 - roomSpread); // Lower spread = higher score
  
  // Bonus for multiple residents (efficiency)
  score += residents.length * 5;
  
  return score;
}
```

## 3B: Day-Of Reminder System

```javascript
interface ReminderConfig {
  hoursBeforeCheckIn: number;  // Default: 2
  messageTemplate: string;
}

const DEFAULT_REMINDER_TEMPLATE = `Hey [NAME]! Quick reminder - I'll stop by around [TIME] for our check-in. See you soon! 🎓

Can't make it? Just reply "reschedule" and we'll find another time.`;

function generateReminders(
  scheduledSlots: ScheduledSlot[],
  config: ReminderConfig
): OutgoingMessage[] {
  const reminders: OutgoingMessage[] = [];
  const now = new Date();
  
  for (const slot of scheduledSlots) {
    const checkInTime = combineDateAndTime(slot.date, slot.time);
    const reminderTime = new Date(checkInTime.getTime() - config.hoursBeforeCheckIn * 60 * 60 * 1000);
    
    // Only generate reminders for future check-ins
    if (reminderTime < now) continue;
    
    for (const resident of slot.residents) {
      reminders.push({
        id: generateUUID(),
        residentId: resident.id,
        messageType: 'reminder',
        content: config.messageTemplate
          .replace('[NAME]', resident.firstName)
          .replace('[TIME]', formatTime(slot.time)),
        scheduledFor: reminderTime,
        status: 'pending',
        sentVia: 'email_to_sms'
      });
    }
  }
  
  return reminders;
}
```

---

# MODULE 4: COMMUNITY BUILDING

## 4A: Shared Class Detector

```javascript
function findSharedClasses(residents: Resident[]): CommunityMatch[] {
  const matches: CommunityMatch[] = [];
  const classCourses: Map<string, string[]> = new Map(); // courseCode -> residentIds
  
  for (const resident of residents) {
    if (!resident.classSchedule) continue;
    
    for (const classBlock of resident.classSchedule) {
      const code = classBlock.courseCode.toUpperCase().replace(/\s+/g, '');
      
      if (!classCourses.has(code)) {
        classCourses.set(code, []);
      }
      classCourses.get(code)!.push(resident.id);
    }
  }
  
  // Create matches for courses with 2+ residents
  for (const [courseCode, residentIds] of classCourses.entries()) {
    if (residentIds.length >= 2) {
      matches.push({
        id: generateUUID(),
        type: 'shared_class',
        residentIds: residentIds,
        details: { className: courseCode },
        suggestedAction: `Create study group for ${courseCode} (${residentIds.length} residents)`,
        actionTaken: false
      });
    }
  }
  
  return matches;
}
```

## 4B: Schedule Overlap Detector

```javascript
function findScheduleOverlaps(residents: Resident[]): CommunityMatch[] {
  const matches: CommunityMatch[] = [];
  
  // Find time slots where multiple residents are free
  const freeSlotMap: Map<string, string[]> = new Map(); // "M-12:00" -> residentIds
  
  for (const resident of residents) {
    if (!resident.freeBlocks) continue;
    
    for (const block of resident.freeBlocks) {
      // Bucket into hour-long slots
      const start = parseInt(block.startTime.split(':')[0]);
      const end = parseInt(block.endTime.split(':')[0]);
      
      for (let hour = start; hour < end; hour++) {
        const key = `${block.day}-${hour.toString().padStart(2, '0')}:00`;
        
        if (!freeSlotMap.has(key)) {
          freeSlotMap.set(key, []);
        }
        freeSlotMap.get(key)!.push(resident.id);
      }
    }
  }
  
  // Find slots with high overlap (5+ residents)
  for (const [slotKey, residentIds] of freeSlotMap.entries()) {
    if (residentIds.length >= 5) {
      const [day, time] = slotKey.split('-');
      
      matches.push({
        id: generateUUID(),
        type: 'schedule_overlap',
        residentIds: residentIds,
        details: {
          timeBlock: {
            day: day as DayCode,
            startTime: time,
            endTime: `${parseInt(time) + 1}:00`
          }
        },
        suggestedAction: `${residentIds.length} residents free ${day} at ${time} - good time for floor event`,
        actionTaken: false
      });
    }
  }
  
  return matches;
}
```

---

# MODULE 5: DASHBOARD & UI

## 5A: Main Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  CheckIn                                           [Settings] [Export]      │
│  Fall 2026 - Mid-Semester Check-Ins                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  PROGRESS                                                           │   │
│  │  ████████████████████░░░░░░░░░░  34/50 residents (68%)             │   │
│  │                                                                     │   │
│  │  📱 Availability received: 42/50                                    │   │
│  │  📅 Scheduled: 34/42                                                │   │
│  │  ✅ Completed: 28/34                                                │   │
│  │  ⏳ Upcoming today: 3                                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────┬──────────┬──────────┬──────────┐                             │
│  │ 📷       │ 📤       │ 📅       │ 👥       │                             │
│  │ Import   │ Send     │ View     │ Community│                             │
│  │ Roster   │ Outreach │ Calendar │ Matches  │                             │
│  └──────────┴──────────┴──────────┴──────────┘                             │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  🔴 NEEDS ATTENTION                                              [View All] │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Sarah M. (312) - Flagged: Financial, Health concerns               │   │
│  │ Jake T. (108) - Rated 2/5, wants to meet                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  📅 TODAY'S CHECK-INS                                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 6:00 PM - Rooms 312, 315, 318 (reminders sent ✓)                   │   │
│  │ 7:30 PM - Room 401 (reminder sent ✓)                               │   │
│  │ 8:00 PM - Rooms 108, 110 (reminders pending)                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ⚪ NOT YET RESPONDED (8 residents)                          [Send Reminder]│
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Mike R. (215), Anna K. (401), Lisa P. (305), +5 more               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 5B: Calendar View

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Check-In Calendar                               ◀ Week of Oct 14 ▶        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  MON 10/14    TUE 10/15    WED 10/16    THU 10/17    FRI 10/18            │
│  ─────────    ─────────    ─────────    ─────────    ─────────            │
│                                                                             │
│               5:00 PM                    5:30 PM                            │
│               ┌───────┐                  ┌───────┐                          │
│               │312,315│                  │401    │                          │
│               │Sarah,J│                  │Anna K │                          │
│               └───────┘                  └───────┘                          │
│                                                                             │
│  6:00 PM                    6:00 PM                                         │
│  ┌───────┐                  ┌───────┐                                       │
│  │108,110│                  │215,218│                                       │
│  │Mike,Li│                  │Tom,Jas│                                       │
│  └───────┘                  └───────┘                                       │
│                                                                             │
│               7:00 PM                                                       │
│               ┌───────┐                                                     │
│               │305,308│                                                     │
│               │Lisa,Em│                                                     │
│               └───────┘                                                     │
│                                                                             │
│  Legend: 🟢 Completed  🟡 Scheduled  🔵 Today  ⚪ Pending                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 5C: Community Matches View

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Community Building Opportunities                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  📚 SHARED CLASSES                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ BIOL 101 (8 residents)                                              │   │
│  │ Sarah M, Jake T, Mike R, Anna K, Lisa P, Tom H, +2 more            │   │
│  │ [Create Study Group Chat] [Send Intro Email]                        │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ PSYCH 101 (5 residents)                                             │   │
│  │ Emma S, Jason L, Kim W, +2 more                                     │   │
│  │ [Create Study Group Chat] [Send Intro Email]                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ⏰ SCHEDULE OVERLAPS                                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Tuesday 12-2pm: 12 residents free                                   │   │
│  │ Great time for: Floor lunch, study session                          │   │
│  │ [View Residents] [Plan Event]                                       │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ Friday after 2pm: 18 residents free                                 │   │
│  │ Great time for: Social event, movie night                           │   │
│  │ [View Residents] [Plan Event]                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

# TECH STACK

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              TECH STACK                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  FRONTEND                                                                   │
│  ─────────                                                                  │
│  • React 18+ with TypeScript                                                │
│  • Tailwind CSS for styling                                                 │
│  • PWA (Progressive Web App) - installable on phone                         │
│  • Service Worker for offline support                                       │
│                                                                             │
│  DATA STORAGE                                                               │
│  ─────────────                                                              │
│  • IndexedDB via Dexie.js (simple IndexedDB wrapper)                        │
│  • All data stored locally in browser                                       │
│  • Export/Import to JSON for backup                                         │
│                                                                             │
│  OCR                                                                        │
│  ───                                                                        │
│  • Tesseract.js v4+ (runs entirely in browser)                              │
│  • No API calls, no cost                                                    │
│                                                                             │
│  MESSAGING (No paid API)                                                    │
│  ─────────────────────────                                                  │
│  • Email-to-SMS gateways (carrier email addresses)                          │
│  • mailto: links for bulk sending                                           │
│  • sms: protocol for individual texts                                       │
│  • navigator.share() API for mobile                                         │
│                                                                             │
│  OPTIONAL ENHANCEMENTS                                                      │
│  ─────────────────────────                                                  │
│  • Google Voice integration (free SMS)                                      │
│  • IMAP connection for reading replies                                      │
│  • Twilio/Plivo (paid, for true automation)                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

# BUILD ORDER FOR CLAUDE CODE

```
PHASE 1: Foundation (Do First)
═══════════════════════════════════════════════════════════════════════════════
1. Initialize React + TypeScript + Tailwind project
2. Set up PWA configuration (manifest.json, service worker)
3. Implement IndexedDB schema with Dexie.js
4. Create all TypeScript interfaces from Data Models section
5. Build basic CRUD operations for all entities
6. Create JSON export/import functionality

PHASE 2: Roster Intake
═══════════════════════════════════════════════════════════════════════════════
1. Integrate Tesseract.js
2. Build image upload component (camera + file picker)
3. Implement roster text parsing logic
4. Create review/edit UI for parsed residents
5. Build resident list view with search/filter

PHASE 3: Outreach System  
═══════════════════════════════════════════════════════════════════════════════
1. Build message template system
2. Implement availability request generation
3. Create mailto: link generator for bulk send
4. Build individual SMS send helper (sms: protocol)
5. Implement availability response parser
6. Create response logging interface

PHASE 4: Schedule OCR
═══════════════════════════════════════════════════════════════════════════════
1. Build schedule photo upload (per resident)
2. Implement class schedule text parsing
3. Create free block computation
4. Build schedule review/edit UI
5. Link schedules to residents

PHASE 5: Scheduling Engine
═══════════════════════════════════════════════════════════════════════════════
1. Implement scheduling algorithm
2. Build calendar view component
3. Create batch optimization logic
4. Build reminder generation system
5. Implement reminder send queue

PHASE 6: Check-In Logging
═══════════════════════════════════════════════════════════════════════════════
1. Create quick-log interface for check-in outcomes
2. Build follow-up tracking system
3. Implement concern flagging and routing
4. Create check-in history view

PHASE 7: Community Building
═══════════════════════════════════════════════════════════════════════════════
1. Implement shared class detection
2. Build schedule overlap finder
3. Create community matches dashboard
4. Build connection suggestion generator

PHASE 8: Dashboard & Reports
═══════════════════════════════════════════════════════════════════════════════
1. Build main dashboard with progress stats
2. Create "needs attention" alert system
3. Implement report generation (PDF/CSV)
4. Build settings and configuration UI

PHASE 9: Polish
═══════════════════════════════════════════════════════════════════════════════
1. Add loading states and error handling
2. Implement offline support
3. Add data validation throughout
4. Mobile responsiveness optimization
5. Add onboarding/tutorial flow
```

---

# SAMPLE COMPONENT: Roster Upload

```tsx
// RosterUpload.tsx - Example component structure

import React, { useState, useRef } from 'react';
import Tesseract from 'tesseract.js';
import { db } from '../db'; // Dexie database instance

interface ParsedResident {
  firstName: string;
  lastName: string;
  room: string;
  email: string;
  phone: string;
  confidence: number;
}

export const RosterUpload: React.FC = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [parsedResidents, setParsedResidents] = useState<ParsedResident[]>([]);
  const [showReview, setShowReview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setProgress(0);

    try {
      const worker = await Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            setProgress(Math.round(m.progress * 100));
          }
        },
      });

      const { data: { text } } = await worker.recognize(file);
      await worker.terminate();

      const residents = parseRosterText(text);
      setParsedResidents(residents);
      setShowReview(true);
    } catch (error) {
      console.error('OCR failed:', error);
      alert('Failed to process image. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImport = async () => {
    // Save to IndexedDB
    for (const resident of parsedResidents) {
      await db.residents.add({
        id: crypto.randomUUID(),
        ...resident,
        carrier: 'unknown',
        availabilityRequestSent: false,
        availabilityReceived: false,
        scheduleUploaded: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        buildingId: 'current-building-id', // Get from context
        raId: 'current-ra-id', // Get from context
      });
    }
    
    // Reset and close
    setParsedResidents([]);
    setShowReview(false);
    // Navigate to resident list or show success
  };

  return (
    <div className="p-4">
      {!showReview ? (
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleImageUpload}
            className="hidden"
          />
          
          {isProcessing ? (
            <div>
              <div className="text-lg mb-2">Processing roster...</div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-2 text-sm text-gray-500">{progress}%</div>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg text-lg"
            >
              📷 Take Photo of Roster
            </button>
          )}
        </div>
      ) : (
        <div>
          <h2 className="text-xl font-bold mb-4">
            Review {parsedResidents.length} Residents
          </h2>
          
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {parsedResidents.map((r, i) => (
              <div 
                key={i}
                className={`p-3 rounded border ${
                  r.confidence < 0.8 ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200'
                }`}
              >
                <div className="flex justify-between">
                  <span>{r.firstName} {r.lastName}</span>
                  <span className="text-gray-500">{r.room}</span>
                </div>
                <div className="text-sm text-gray-500">
                  {r.phone} • {r.email}
                </div>
              </div>
            ))}
          </div>
          
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setShowReview(false)}
              className="px-4 py-2 border rounded"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              className="px-4 py-2 bg-blue-600 text-white rounded flex-1"
            >
              Import {parsedResidents.length} Residents
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
```

---

# DEPLOYMENT

```
LOCAL-FIRST DEPLOYMENT
═══════════════════════════════════════════════════════════════════════════════

Option 1: Static PWA (Simplest)
─────────────────────────────────
• Build: npm run build
• Host on: GitHub Pages, Netlify, Vercel (all free)
• Works offline after first visit
• All data stays in user's browser

Option 2: Desktop App (Electron/Tauri)
─────────────────────────────────
• Wrap PWA in native container
• Better file system access
• Can run completely offline

Option 3: Self-Hosted (Advanced)
─────────────────────────────────
• Add backend for multi-user support
• Sync data across devices
• Could enable true SMS automation
```

---

# FUTURE ENHANCEMENTS (V2+)

```
• Twilio/Plivo integration for automated SMS
• Multi-RA support with shared buildings
• Supervisor dashboard for RDs/CDs
• Integration with StarRez/Roompact/Maxient
• AI sentiment analysis of free-text responses
• Predictive flagging based on patterns
• Year-over-year resident tracking
• Automated conduct referral drafting
```

---

**Hand this entire document to Claude Code with the prompt:**

> "Build this CheckIn system as specified. Start with Phase 1-3. Use React, TypeScript, Tailwind, Dexie.js for IndexedDB, and Tesseract.js for OCR. Make it a PWA that works offline. No external paid APIs."

---

*CheckIn: RAs should be building relationships, not chasing door knocks.*
