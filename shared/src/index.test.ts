import { describe, expect, it } from 'vitest';
import {
  TIMBRE_MAX,
  TIMBRE_MIN,
  computeDocTotals,
  documentTypes,
  fiscalStamp,
  ledgerEffect,
  partnerRequiredTypes,
  pumpRecalculatingTypes,
  stockConsumingTypes,
  stockReceivingTypes,
  type DocumentType,
  type TotalsLine
} from './index';

/**
 * These tests are the regression net around the money-handling core. Every rule
 * asserted here is one the business depends on daily — if a change breaks one,
 * it should fail loudly at CI time rather than corrupt a margin or a balance.
 */

function line(partial: Partial<TotalsLine> = {}): TotalsLine {
  return { quantity: 1, unitPriceHT: 100, discountPercent: 0, tvaRate: 19, purchaseCostPUMP: 60, ...partial };
}

describe('stock direction lists', () => {
  it('no document type both receives and consumes stock', () => {
    for (const t of stockConsumingTypes) expect(stockReceivingTypes).not.toContain(t);
  });

  it('COMMANDE and PROFORMA have no stock effect at all', () => {
    for (const t of ['COMMANDE', 'PROFORMA'] as DocumentType[]) {
      expect(stockConsumingTypes).not.toContain(t);
      expect(stockReceivingTypes).not.toContain(t);
    }
  });

  it('only a true purchase re-bases P.U.M.P', () => {
    expect(pumpRecalculatingTypes).toEqual(['ACHAT']);
  });

  it('every commercial type requires a partner; internal movements do not', () => {
    expect(partnerRequiredTypes).toContain('COMMANDE');
    for (const t of ['REGULE_PLUS', 'REGULE_MOINS', 'TRANSFERT'] as DocumentType[]) {
      expect(partnerRequiredTypes).not.toContain(t);
    }
  });
});

describe('ledgerEffect', () => {
  it('sales-side documents increase what the client owes and bring cash in', () => {
    for (const t of ['BON_PREPARATION', 'VENTE', 'FACTURE'] as DocumentType[]) {
      expect(ledgerEffect(t)).toEqual({ partnerBalanceSign: 1, cashType: 'RECETTE' });
    }
  });

  it('a purchase increases what we owe the supplier and sends cash out', () => {
    expect(ledgerEffect('ACHAT')).toEqual({ partnerBalanceSign: 1, cashType: 'DEPENSE' });
  });

  it('returns invert the financial direction of their original document', () => {
    expect(ledgerEffect('RETOUR_CLIENT')).toEqual({ partnerBalanceSign: -1, cashType: 'DEPENSE' });
    expect(ledgerEffect('RETOUR_FOURNISSEUR')).toEqual({ partnerBalanceSign: -1, cashType: 'RECETTE' });
  });

  it('quotes, purchase orders and internal movements never touch a balance', () => {
    for (const t of ['PROFORMA', 'COMMANDE', 'REGULE_PLUS', 'REGULE_MOINS', 'TRANSFERT'] as DocumentType[]) {
      expect(ledgerEffect(t)).toEqual({ partnerBalanceSign: 0, cashType: null });
    }
  });

  it('is exhaustively defined for every declared document type', () => {
    for (const t of documentTypes) {
      const effect = ledgerEffect(t);
      expect([1, -1, 0]).toContain(effect.partnerBalanceSign);
    }
  });
});

describe('fiscalStamp (timbre fiscal)', () => {
  it('applies only to cash payments', () => {
    expect(fiscalStamp(10000, 'CHEQUE')).toBe(0);
    expect(fiscalStamp(10000, 'VIREMENT')).toBe(0);
    expect(fiscalStamp(10000, 'TRAITE')).toBe(0);
    expect(fiscalStamp(10000, 'ESPECE')).toBe(100);
  });

  it('is 1% of the pre-stamp TTC', () => {
    expect(fiscalStamp(123456, 'ESPECE')).toBe(1234.56);
  });

  it('clamps to the legal floor of 5 DZD on small cash sales', () => {
    expect(fiscalStamp(120, 'ESPECE')).toBe(TIMBRE_MIN); // 1% would be 1.20
  });

  it('clamps to the legal ceiling of 2500 DZD on large cash sales', () => {
    expect(fiscalStamp(1_000_000, 'ESPECE')).toBe(TIMBRE_MAX); // 1% would be 10 000
  });

  it('never charges a stamp on a zero or negative total', () => {
    expect(fiscalStamp(0, 'ESPECE')).toBe(0);
    expect(fiscalStamp(-50, 'ESPECE')).toBe(0);
  });
});

describe('computeDocTotals', () => {
  it('computes HT, TVA and TTC for a simple cash sale', () => {
    const totals = computeDocTotals([line({ quantity: 2, unitPriceHT: 1000, tvaRate: 19, purchaseCostPUMP: 700 })], 0, 'ESPECE');
    expect(totals.totalHT).toBe(2000);
    expect(totals.totalTVA).toBeCloseTo(380, 6);
    // pre-stamp TTC 2380 → stamp 23.80
    expect(totals.stampDuty).toBeCloseTo(23.8, 6);
    expect(totals.totalTTC).toBeCloseTo(2403.8, 6);
    expect(totals.marginHT).toBe(600); // 2000 - 2*700
    expect(totals.marginPercent).toBeCloseTo(30, 6);
  });

  it('applies per-line discounts before TVA', () => {
    const totals = computeDocTotals([line({ quantity: 1, unitPriceHT: 1000, discountPercent: 10, tvaRate: 19 })], 0, 'CHEQUE');
    expect(totals.totalHT).toBeCloseTo(900, 6);
    expect(totals.totalTVA).toBeCloseTo(171, 6);
    expect(totals.stampDuty).toBe(0);
    expect(totals.totalTTC).toBeCloseTo(1071, 6);
  });

  it('mixes TVA rates per line rather than using one global rate', () => {
    const totals = computeDocTotals(
      [line({ unitPriceHT: 100, tvaRate: 19 }), line({ unitPriceHT: 100, tvaRate: 0 }), line({ unitPriceHT: 100, tvaRate: 9 })],
      0,
      'VIREMENT'
    );
    expect(totals.totalHT).toBe(300);
    expect(totals.totalTVA).toBeCloseTo(28, 6); // 19 + 0 + 9
  });

  it('deducts the global remise before computing the stamp', () => {
    const totals = computeDocTotals([line({ unitPriceHT: 10000, tvaRate: 0 })], 1000, 'ESPECE');
    // pre-stamp TTC = 10000 - 1000 = 9000 → stamp 90
    expect(totals.stampDuty).toBeCloseTo(90, 6);
    expect(totals.totalTTC).toBeCloseTo(9090, 6);
  });

  it('margin can go negative when selling under cost — it must not be masked', () => {
    const totals = computeDocTotals([line({ unitPriceHT: 50, purchaseCostPUMP: 80, tvaRate: 0 })], 0, 'CHEQUE');
    expect(totals.marginHT).toBe(-30);
    expect(totals.marginPercent).toBeCloseTo(-60, 6);
  });

  it('an empty document totals to zero without dividing by zero', () => {
    const totals = computeDocTotals([], 0, 'ESPECE');
    expect(totals.totalHT).toBe(0);
    expect(totals.marginPercent).toBe(0);
    expect(totals.stampDuty).toBe(0);
  });
});
