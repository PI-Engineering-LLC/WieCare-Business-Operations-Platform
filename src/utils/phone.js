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
  function formatToStrict13(rawPhone, countryCode = "1") {
    // Remove all non-numeric characters
    const digits = rawPhone.replace(/\D/g, '');
    let result = `+${countryCode}${digits}`;
    
    // Handle 10-digit inputs
    if (digits.length === 10) {
      return result.padEnd(13, ' ');
    }

    if (result.length < 13) {
      // Pad with zeros to meet the 13-char requirement
      result = result.padEnd(13, ' '); 
    } else if (result.length > 13) {
      // Truncate if too long (dangerous, but meets requirement)
      result = result.substring(0, 13);
    }
    
    // 3. Handle cases where it might already be correct
    return result;
  }
  function formatToStrict13Digits(rawPhone, countryCode = "1") {
    // Remove all non-numeric characters
    const digits = rawPhone.replace(/\D/g, '');
    let result = `+${countryCode}${digits}`;
    
    // Handle 10-digit inputs
    if (digits.length === 10) {
      return result.padEnd(13, '0');
    }

    if (result.length < 13) {
      // Pad with zeros to meet the 13-char requirement
      result = result.padEnd(13, '0'); 
    } else if (result.length > 13) {
      // Truncate if too long (dangerous, but meets requirement)
      result = result.substring(0, 13);
    }
    
    // 3. Handle cases where it might already be correct
    return result;
  }
  module.exports = {normalizePhone, formatToStrict13};
  
