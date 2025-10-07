/**
 * VIN validation utilities with check-digit algorithm
 */

// Transliteration map for VIN check-digit calculation
function transliterate(ch: string): number {
  const map: Record<string, number> = {
    A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
    J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
    S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9
  };
  if (/[0-9]/.test(ch)) return parseInt(ch, 10);
  return map[ch] || 0;
}

/**
 * Compute VIN check digit using official algorithm
 * @param vin - 17-character VIN
 * @returns Check digit ('0'-'9' or 'X')
 */
export function computeVINCheckDigit(vin: string): string {
  const vinUpper = vin.toUpperCase();
  const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;

  for (let i = 0; i < 17; i++) {
    const val = transliterate(vinUpper[i]);
    sum += val * weights[i];
  }

  const rem = sum % 11;
  return rem === 10 ? 'X' : String(rem);
}

/**
 * Validate VIN format and check digit
 * @param vin - VIN to validate
 * @returns true if valid VIN
 */
export function isValidVIN(vin: string | null | undefined): boolean {
  if (!vin || typeof vin !== 'string') return false;

  const vinTrimmed = vin.trim().toUpperCase();

  // Must be exactly 17 characters
  if (vinTrimmed.length !== 17) return false;

  // Letters I, O, Q are not allowed in VINs
  if (/[IOQ]/.test(vinTrimmed)) return false;

  // Validate check digit (position 9, index 8)
  const check = computeVINCheckDigit(vinTrimmed);
  return vinTrimmed[8] === check;
}

/**
 * Extract valid VIN from a longer string
 * Searches for 17-character windows that pass validation
 * @param text - Text potentially containing a VIN
 * @returns Valid VIN or null
 */
export function extractVIN(text: string): string | null {
  const cleaned = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  // Search for 17-character windows
  for (let i = 0; i <= cleaned.length - 17; i++) {
    const candidate = cleaned.substring(i, i + 17);
    if (isValidVIN(candidate)) {
      return candidate;
    }
  }

  return null;
}
