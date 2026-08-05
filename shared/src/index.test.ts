import { describe, expect, it } from 'vitest';
import {
  TIMBRE_SEUIL_MIN,
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

describe('fiscalStamp — barème progressif par tranche', () => {
  it("ne s'applique qu'aux règlements en espèces", () => {
    expect(fiscalStamp(10000, 'CHEQUE')).toBe(0);
    expect(fiscalStamp(10000, 'VIREMENT')).toBe(0);
    expect(fiscalStamp(10000, 'TRAITE')).toBe(0);
    expect(fiscalStamp(10000, 'ESPECE')).toBe(100);
  });

  it('aucun timbre en dessous de 300 DZD', () => {
    expect(fiscalStamp(299.99, 'ESPECE')).toBe(0);
    expect(fiscalStamp(1, 'ESPECE')).toBe(0);
  });

  it('1 % de 300 à 30 000 DZD', () => {
    expect(fiscalStamp(300, 'ESPECE')).toBe(3);
    expect(fiscalStamp(29999, 'ESPECE')).toBeCloseTo(299.99, 6);
  });

  it('1,5 % de 30 000 à 100 000 DZD', () => {
    expect(fiscalStamp(30000, 'ESPECE')).toBe(450);
    expect(fiscalStamp(99999, 'ESPECE')).toBeCloseTo(1499.99, 6);
  });

  it('2 % au-delà de 100 000 DZD', () => {
    expect(fiscalStamp(100000, 'ESPECE')).toBe(2000);
    expect(fiscalStamp(1000000, 'ESPECE')).toBe(20000);
  });

  it('le taux de la tranche porte sur la totalité du montant, pas sur la fraction', () => {
    // 30 000 franchit la tranche: 1,5 % de 30 000 = 450, et non 1 % de 30 000 + marginal.
    expect(fiscalStamp(30000, 'ESPECE')).toBe(450);
    expect(fiscalStamp(29999.99, 'ESPECE')).toBeLessThan(450);
  });

  it('le barème est continu et croissant aux bornes', () => {
    expect(fiscalStamp(TIMBRE_SEUIL_MIN, 'ESPECE')).toBeGreaterThan(fiscalStamp(TIMBRE_SEUIL_MIN - 0.01, 'ESPECE'));
    expect(fiscalStamp(30000, 'ESPECE')).toBeGreaterThan(fiscalStamp(29999.99, 'ESPECE'));
    expect(fiscalStamp(100000, 'ESPECE')).toBeGreaterThan(fiscalStamp(99999.99, 'ESPECE'));
  });

  it('aucun timbre sur un total nul ou négatif', () => {
    expect(fiscalStamp(0, 'ESPECE')).toBe(0);
    expect(fiscalStamp(-50, 'ESPECE')).toBe(0);
  });
});

describe('computeDocTotals', () => {
  it('computes HT, TVA and TTC for a simple cash sale', () => {
    const totals = computeDocTotals([line({ quantity: 2, unitPriceHT: 1000, tvaRate: 19, purchaseCostPUMP: 700 })], 0, 'ESPECE');
    expect(totals.totalHT).toBe(2000);
    expect(totals.totalTVA).toBeCloseTo(380, 6);
    // TTC avant timbre 2380 → tranche 1 % → 23,80
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
    // TTC avant timbre = 10000 - 1000 = 9000 → tranche 1 % → 90
    expect(totals.stampDuty).toBeCloseTo(90, 6);
    expect(totals.totalTTC).toBeCloseTo(9090, 6);
  });

  it('la remise peut faire basculer la vente dans une tranche de timbre inférieure', () => {
    const sans = computeDocTotals([line({ unitPriceHT: 31000, tvaRate: 0 })], 0, 'ESPECE');
    const avec = computeDocTotals([line({ unitPriceHT: 31000, tvaRate: 0 })], 2000, 'ESPECE');
    expect(sans.stampDuty).toBeCloseTo(465, 6); // 31 000 → 1,5 %
    expect(avec.stampDuty).toBeCloseTo(290, 6); // 29 000 → 1 %
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
