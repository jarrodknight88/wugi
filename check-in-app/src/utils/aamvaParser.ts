// ─────────────────────────────────────────────────────────────────────
// AAMVA Parser — reads PDF417 barcode data from US/CA driver's licenses
// Standard: AAMVA DL/ID Card Design Standard
// ─────────────────────────────────────────────────────────────────────

export interface ParsedID {
  firstName: string;
  lastName: string;
  fullName: string;
  dob: string;          // YYYY-MM-DD
  dobDisplay: string;   // MM/DD/YYYY
  age: number;
  idNumber: string;
  idNumberLast4: string;
  state: string;
  expiryDate: string;
  isExpired: boolean;
  rawData: string;
}

function parseDate(raw: string): { iso: string; display: string; isExpired: boolean } {
  let month = '', day = '', year = '';
  if (raw.length === 8) {
    if (parseInt(raw.slice(0, 4)) > 1900) {
      // YYYYMMDD
      year = raw.slice(0, 4); month = raw.slice(4, 6); day = raw.slice(6, 8);
    } else {
      // MMDDYYYY
      month = raw.slice(0, 2); day = raw.slice(2, 4); year = raw.slice(4, 8);
    }
  }
  const iso = `${year}-${month}-${day}`;
  const display = `${month}/${day}/${year}`;
  const isExpired = new Date(iso) < new Date();
  return { iso, display, isExpired };
}

function calculateAge(dobIso: string): number {
  const dob = new Date(dobIso);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

export function parseAAMVA(raw: string): ParsedID | null {
  try {
    // Split into lines — AAMVA uses \n or \r\n
    const lines = raw.split(/[\r\n]+/);
    const fields: Record<string, string> = {};

    for (const line of lines) {
      if (line.length >= 3) {
        const code = line.slice(0, 3);
        const value = line.slice(3).trim();
        fields[code] = value;
      }
    }

    const lastName  = fields['DCS'] || fields['DAB'] || '';
    const firstName = fields['DAC'] || fields['DCT']?.split(',')[0] || '';
    const dobRaw    = fields['DBB'] || '';
    const expRaw    = fields['DBA'] || '';
    const idNumber  = fields['DAQ'] || '';
    const state     = fields['DAJ'] || '';

    if (!lastName && !firstName) return null;

    const dob    = dobRaw  ? parseDate(dobRaw)  : { iso: '', display: '', isExpired: false };
    const expiry = expRaw  ? parseDate(expRaw)  : { iso: '', display: '', isExpired: false };
    const age    = dob.iso ? calculateAge(dob.iso) : 0;

    const fullName = `${firstName} ${lastName}`.trim();

    return {
      firstName,
      lastName,
      fullName,
      dob: dob.iso,
      dobDisplay: dob.display,
      age,
      idNumber,
      idNumberLast4: idNumber.slice(-4),
      state,
      expiryDate: expiry.display,
      isExpired: expiry.isExpired,
      rawData: raw,
    };
  } catch {
    return null;
  }
}

// Fuzzy name match — handles "SMITH JORDAN" vs "Jordan Smith"
// Returns 0-1 score, >= 0.7 is a match
export function nameMatchScore(idName: string, ticketName: string): number {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/).sort().join(' ');

  const a = normalize(idName);
  const b = normalize(ticketName);
  if (a === b) return 1.0;

  // Check if all words from shorter name appear in longer name
  const aWords = a.split(' ');
  const bWords = b.split(' ');
  const shorter = aWords.length <= bWords.length ? aWords : bWords;
  const longer  = aWords.length <= bWords.length ? bWords : aWords;
  const matches = shorter.filter(w => longer.some(lw => lw.startsWith(w) || w.startsWith(lw)));
  return matches.length / shorter.length;
}
