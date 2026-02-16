/**
 * Format a number with thousands separator (comma).
 * Provides consistent formatting regardless of system locale.
 *
 * @param num - Number to format
 * @returns Formatted string with comma as thousands separator
 *
 * @example
 * formatNumber(1500) // "1,500"
 * formatNumber(10000) // "10,000"
 * formatNumber(4500.50) // "4,500.5"
 */
export function formatNumber(num: number): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format a number as compact string (K/M/B suffixes).
 *
 * @param num - Number to format
 * @returns Compact string representation
 *
 * @example
 * formatNumberCompact(1500) // "1.5K"
 * formatNumberCompact(1000000) // "1M"
 * formatNumberCompact(150) // "150"
 */
export function formatNumberCompact(num: number): string {
  if (num < 1000) return num.toString();

  const suffixes = ['', 'K', 'M', 'B', 'T'];
  const suffixNum = Math.floor(Math.log10(num) / 3);
  const shortValue = (num / Math.pow(1000, suffixNum)).toFixed(1);

  return shortValue + suffixes[suffixNum];
}
