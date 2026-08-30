/**
 * Format a number as French currency (€)
 */
// Formatage devise mis en cache : Intl.NumberFormat est coûteux à construire
// (≈ 0,3 ms / instance) et formatCurrency est appelé des milliers de fois
// (dashboard, listes, rapports). On instancie une fois pour toute l'app.
const EUR0 = new Intl.NumberFormat('fr-FR', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0,
});

export function formatCurrency(value, showSign = false) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  const num = Number(value);
  const formatted = EUR0.format(Math.abs(num));

  if (showSign && num > 0) return `+${formatted}`;
  if (num < 0) return `-${formatted.replace('-', '')}`;
  return formatted;
}

/**
 * Format a number as French currency with decimals
 */
const EUR2 = new Intl.NumberFormat('fr-FR', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function formatCurrencyDecimal(value) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return EUR2.format(value);
}

/**
 * Format a percentage
 */
export function formatPercent(value, decimals = 2) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return `${Number(value).toFixed(decimals).replace('.', ',')} %`;
}

/**
 * Format a date in French format
 */
export function formatDateFR(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR');
}

/**
 * Get month name in French
 */
const MONTHS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

export function getMonthName(monthNum) {
  return MONTHS_FR[monthNum - 1] || '';
}

export function getShortMonthName(monthNum) {
  return MONTHS_FR[monthNum - 1]?.substring(0, 3) || '';
}

/**
 * Calculate gross yield
 */
export function calcGrossYield(annualRent, totalCost) {
  if (!totalCost || totalCost === 0) return 0;
  return (annualRent / totalCost) * 100;
}

/**
 * Calculate net yield
 */
export function calcNetYield(annualRent, annualCharges, totalCost) {
  if (!totalCost || totalCost === 0) return 0;
  return ((annualRent - annualCharges) / totalCost) * 100;
}

/**
 * Calculate total acquisition cost
 */
export function calcTotalAcquisition(property) {
  return (property.purchase_price || 0) +
    (property.notary_fees || 0) +
    (property.agency_fees || 0) +
    (property.initial_works || 0);
}

/**
 * Calculate total monthly payment (loan + insurance)
 */
export function calcTotalMonthlyPayment(property) {
  return (property.monthly_payment || 0) + (property.monthly_insurance || 0);
}

/**
 * Calculate total annual charges
 */
export function calcTotalAnnualCharges(property) {
  return (property.property_tax || 0) +
    (property.pno_insurance || 0) +
    (property.condo_fees || 0) +
    (property.management_fees || 0) +
    (property.accountant_fees || 0) +
    (property.other_annual_charges || 0);
}