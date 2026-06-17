/**
 * Normalizes a 10-digit phone number to +xxxxxxxxxxxx
 * @param {string} rawPhone - e.g., "4068801345"
 * @param {string} countryCode - e.g., "1" (for North America)
 */
function normalizePhone(rawPhone, countryCode = "1") {
    // Remove all non-numeric characters
    const digits = rawPhone.replace(/\D/g, '');
    
    // Handle 10-digit inputs
    if (digits.length === 10) {
      return `+${countryCode}${digits}`;
    }
    
    // 3. Handle cases where it might already be correct
    return `+${digits}`;
  }
  module.exports = normalizePhone;
  
