import { describe, it, expect } from 'vitest';
import {
  detectSeparator,
  parseCsv,
  parseCsvTable,
  findField,
  parseFrenchNumber,
  normalizeAmount,
  toNumber,
  parseAndValidateDate,
  parseDate,
  guessMonthYear,
  matchTenantLot,
  isCafText,
} from '../../src/lib/import/csvUtils.js';

describe('detectSeparator — détection robuste hors guillemets', () => {
  it('; si présent, sinon ,', () => {
    expect(detectSeparator('a;b;c')).toBe(';');
    expect(detectSeparator('a,b,c')).toBe(',');
  });
  it('ignore les séparateurs entre guillemets', () => {
    expect(detectSeparator('"a;b";c;d')).toBe(';');
    expect(detectSeparator('"a,b",c,d')).toBe(',');
  });
  it('défaut ; si aucun séparateur', () => {
    expect(detectSeparator('solo')).toBe(';');
    expect(detectSeparator('')).toBe(';');
  });
  it('BOM UTF-8 ignorée', () => {
    expect(detectSeparator('\ufeffa;b;c')).toBe(';');
  });
  it('choisit le plus fréquent sur un échantillon', () => {
    expect(detectSeparator('a;b;c;d;e\n1;2;3;4;5\nx;y;z;w;v')).toBe(';');
    expect(detectSeparator('a,b,c\nd,e,f')).toBe(',');
  });
});

describe('parseCsv — RFC 4180', () => {
  it('en-têtes + lignes simple, séparateur virgule', () => {
    const { headers, rows, meta } = parseCsv('Date,Libellé,Montant\n2024-01-05,Loyer,900');
    expect(headers).toEqual(['Date', 'Libellé', 'Montant']);
    expect(rows.length).toBe(1);
    expect(rows[0].Libellé).toBe('Loyer');
    expect(rows[0].Montant).toBe('900');
    expect(meta.valid).toBe(1);
    expect(meta.rejected).toBe(0);
  });

  it('séparateur point-virgule + BOM', () => {
    const text = '\ufeffDate;Montant\n05/01/2024;1 200,50';
    const { headers, rows } = parseCsv(text);
    expect(headers).toEqual(['Date', 'Montant']);
    expect(rows[0].Montant).toBe('1 200,50');
  });

  it('guillemets + séparateur à l\'intérieur du champ', () => {
    const { rows } = parseCsv('Nom;Montant\n"DUPONT; Jean";"1.234,56 €"');
    expect(rows[0].Nom).toBe('DUPONT; Jean');
    expect(rows[0].Montant).toBe('1.234,56 €');
  });

  it('guillemets échappés (doubled "")', () => {
    const { rows } = parseCsv('a,b\n"dit ""Bob""",12');
    expect(rows[0].a).toBe('dit "Bob"');
    expect(rows[0].b).toBe('12');
  });

  it('retour à la ligne à l\'intérieur d\'un champ guillemeté', () => {
    const text = 'desc;montant\n"ligne1\nligne2";42';
    const { rows } = parseCsv(text);
    expect(rows[0].desc).toBe('ligne1\nligne2');
    expect(rows[0].montant).toBe('42');
  });

  it('détection automatique du séparateur (,) quand virgule majoritaire', () => {
    const { delimiter, rows } = parseCsv('date,libelle,montant\n2024,abc,10');
    expect(delimiter).toBe(',');
    expect(rows[0].libelle).toBe('abc');
  });

  it('colonnes vides conservées (pas de troncation)', () => {
    const { rows, rawRows } = parseCsv('a;b;c\n1;;3');
    expect(rows[0].b).toBe('');
    expect(rawRows[0]).toEqual(['1', '', '3']);
  });

  it('lignes vides ignorées avec avertissement (non perdues silencieusement)', () => {
    const { meta, rows } = parseCsv('a;b\n1;2\n\n3;4');
    expect(rows.length).toBe(2);
    expect(meta.warnings.some((w) => w.message.includes('ligne vide'))).toBe(true);
  });

  it('ligne plus courte → colonnes vides ajoutées + avertissement', () => {
    const { rows, rawRows, meta } = parseCsv('a;b;c\n1;2');
    expect(rawRows[0].length).toBe(3);
    expect(rows[0].c).toBe('');
    expect(meta.warnings.some((w) => w.message.includes('colonnes'))).toBe(true);
  });

  it('ligne plus longue → valeurs excédentaires conservées (__extra), non tronquées', () => {
    const { rows, rawRows, meta } = parseCsv('a;b\n1;2;3;4');
    expect(rawRows[0].length).toBeGreaterThanOrEqual(4);
    expect(rows[0].__extra).toBe('3;4');
    expect(meta.warnings.some((w) => w.message.includes('excédentaires'))).toBe(true);
  });

  it('guillemet non fermé → rejeté avec erreur, valeurs conservées', () => {
    const { meta, rawRows } = parseCsv('a;b\n"non ferme;ici');
    expect(meta.rejected).toBe(1);
    expect(meta.errors[0].message).toBe('guillemet non fermé');
    expect(rawRows.length).toBe(1);
  });

  it('rapport d\'import : lues / valides / rejetées', () => {
    const text = 'date;montant\n05/01/2024;10\n07/01/2024;20\n"bad\n08/01/2024;30';
    const { meta } = parseCsv(text);
    expect(meta.total).toBe(3);
    expect(meta.rejected).toBe(1);
    expect(meta.valid).toBe(2);
    expect(meta.errors.length).toBe(1);
  });

  it('fichiers bancaires FR : espaces fines, €, notation 42,30-', () => {
    const { rows } = parseCsv('date;montant\n05/01/2024;"1\u00A0234,56 €"');
    expect(rows[0].montant).toBe('1\u00A0234,56 €');
  });

  it('grands fichiers (_perfforme en O(n), pas de RegExp globale_)', () => {
    const lines = ['a;b'];
    for (let i = 0; i < 5000; i++) lines.push(`${i};${i * 2}`);
    const { rows, meta } = parseCsv(lines.join('\n'));
    expect(meta.valid).toBe(5000);
    expect(rows.length).toBe(5000);
    expect(rows[4999].b).toBe(String(4999 * 2));
  });

  it('hasHeader:false → pas d\'en-tête, headers=[]', () => {
    const { headers, rawRows } = parseCsv('1;2;3\n4;5;6', { hasHeader: false });
    expect(headers).toEqual([]);
    expect(rawRows.length).toBe(2);
  });

  it('en-têtes dupliqués : accès index-safe via __col_N', () => {
    const { rows } = parseCsv('libelle;libelle\na;b');
    expect(rows[0].__col_0).toBe('a');
    expect(rows[0].__col_1).toBe('b');
  });
});

describe('parseCsvTable — façade de compatibilité', () => {
  it('retourne { headers, rows } inchangé', () => {
    const { headers, rows } = parseCsvTable('a;b\n1;2');
    expect(headers).toEqual(['a', 'b']);
    expect(rows[0].a).toBe('1');
  });
});

describe('parseFrenchNumber — montants français stricts', () => {
  it('"1 234,56" → 1234.56', () => {
    expect(parseFrenchNumber('1 234,56')).toEqual({ ok: true, value: 1234.56 });
  });
  it('"1234,56" → 1234.56', () => {
    expect(parseFrenchNumber('1234,56').value).toBeCloseTo(1234.56, 2);
  });
  it('"1234.56" → 1234.56', () => {
    expect(parseFrenchNumber('1234.56').value).toBeCloseTo(1234.56, 2);
  });
  it('"1.234,56 €" → 1234.56 (guillemet/symbole)', () => {
    const r = parseFrenchNumber('"1.234,56 €"');
    expect(r.ok).toBe(true);
    expect(r.value).toBeCloseTo(1234.56, 2);
  });
  it('"-42,30" → -42.3', () => {
    expect(parseFrenchNumber('-42,30').value).toBeCloseTo(-42.3, 1);
  });
  it('"42,30-" (notation FR) → -42.3', () => {
    expect(parseFrenchNumber('42,30-').value).toBeCloseTo(-42.3, 1);
  });
  it('"(123,45)" (compta) → -123.45', () => {
    expect(parseFrenchNumber('(123,45)').value).toBeCloseTo(-123.45, 2);
  });
  it('espace insécable + € → ok', () => {
    expect(parseFrenchNumber('1\u00A0234,56\u00A0€').value).toBeCloseTo(1234.56, 2);
  });
  it('"0,00" → 0 valide (pas null)', () => {
    expect(parseFrenchNumber('0,00')).toEqual({ ok: true, value: 0 });
  });
  it('vide → ok:false (jamais 0 silencieux)', () => {
    const r = parseFrenchNumber('');
    expect(r.ok).toBe(false);
    expect(r.value).toBeNull();
    expect(r.error).toBeTruthy();
  });
  it('null → ok:false', () => {
    expect(parseFrenchNumber(null).ok).toBe(false);
  });
  it('texte non numérique → ok:false', () => {
    const r = parseFrenchNumber('abc');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('invalide');
  });
  it('montant avec lettres mélangées → ok:false', () => {
    expect(parseFrenchNumber('12abc34').ok).toBe(false);
  });
});

describe('normalizeAmount — number | null', () => {
  it('1234.56', () => expect(normalizeAmount('1 234,56')).toBeCloseTo(1234.56, 2));
  it('invalide → null (pas 0)', () => {
    expect(normalizeAmount('')).toBeNull();
    expect(normalizeAmount('abc')).toBeNull();
    expect(normalizeAmount(null)).toBeNull();
  });
  it('0 valide → 0 (pas null)', () => {
    expect(normalizeAmount('0,00')).toBe(0);
  });
});

describe('parseAndValidateDate — validation calendaire stricte', () => {
  it('dd/mm/yyyy valide', () => {
    const r = parseAndValidateDate('05/01/2024');
    expect(r.ok).toBe(true);
    expect(r.value).toBe('2024-01-05');
    expect(r).toMatchObject({ day: 5, month: 1, year: 2024 });
  });
  it('yyyy-mm-dd valide', () => {
    expect(parseAndValidateDate('2024-01-05').value).toBe('2024-01-05');
  });
  it('dd.mm.yyyy valide', () => {
    expect(parseAndValidateDate('05.01.2024').value).toBe('2024-01-05');
  });
  it('31/02/2026 → invalide (date inexistante)', () => {
    const r = parseAndValidateDate('31/02/2026');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('invalide');
  });
  it('13/2026 → invalide (format non reconnu)', () => {
    const r = parseAndValidateDate('13/2026');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('non reconnu');
  });
  it('29/02/2024 bissextile → valide', () => {
    expect(parseAndValidateDate('29/02/2024').ok).toBe(true);
  });
  it('29/02/2025 non bissextile → invalide', () => {
    expect(parseAndValidateDate('29/02/2025').ok).toBe(false);
  });
  it('31/04/2026 → invalide (avril = 30 j)', () => {
    expect(parseAndValidateDate('31/04/2026').ok).toBe(false);
  });
  it('vide → ok:false (jamais silently null)', () => {
    expect(parseAndValidateDate('').ok).toBe(false);
  });
  it('texte quelconque → ok:false', () => {
    expect(parseAndValidateDate('toto').ok).toBe(false);
  });
});

describe('parseDate — façade legacy (null sur invalide)', () => {
  it('valide → { day, month, year }', () => {
    expect(parseDate('05/01/2024')).toEqual({ day: 5, month: 1, year: 2024 });
  });
  it('invalide calendaire → null (pas de faux positif)', () => {
    expect(parseDate('31/02/2026')).toBeNull();
  });
  it('vide → null', () => expect(parseDate('')).toBeNull());
});

describe('toNumber — façade legacy (0 sur invalide)', () => {
  it('1 200,50 → 1200.5', () => {
    expect(toNumber('1 200,50')).toBe(1200.5);
  });
  it('900 → 900', () => expect(toNumber('900')).toBe(900));
  it('vide → 0', () => expect(toNumber('')).toBe(0));
  it('null → 0', () => expect(toNumber(null)).toBe(0));
});

describe('findField / isCafText / guessMonthYear / matchTenantLot', () => {
  it('findField : indice par mot-clé insensible à la casse', () => {
    expect(findField(['Date op', 'Libelle'], ['montant', 'libelle'])).toBe(1);
  });
  it('isCafText : détection CAF', () => {
    expect(isCafText('AllocataireCAF')).toBe(true);
    expect(isCafText('Virement loyer')).toBe(false);
  });
  it('guessMonthYear : mois en lettres + année', () => {
    expect(guessMonthYear('janvier 2024')).toEqual({ month: 1, year: 2024 });
  });
  it('guessMonthYear : MM/YYYY (03/2024)', () => {
    expect(guessMonthYear('03/2024')).toEqual({ month: 3, year: 2024 });
  });
  it('guessMonthYear : 13/2024 invalide → fallback (mois 13 rejeté, pas month=13)', () => {
    const r = guessMonthYear('13/2024', '');
    expect(r.month).toBeGreaterThanOrEqual(1);
    expect(r.month).toBeLessThanOrEqual(12);
  });
  it('matchTenantLot : rapproche par nom', () => {
    const lot = { tenant_name: 'Jean Dupont' };
    expect(matchTenantLot('VIR Jean Dupont loyer', [lot])).toBe(lot);
    expect(matchTenantLot('Autre chose', [lot])).toBeNull();
  });
});