import { describe, expect, it } from 'vitest';
import {
  TIMBRE_SEUIL_MIN,
  computeDocTotals,
  documentTypes,
  evaluatePartnerBlocking,
  fiscalStamp,
  ledgerEffect,
  partnerRequiredTypes,
  pumpRecalculatingTypes,
  quantiteDepuisColis,
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

describe('bonus et ristourne', () => {
  it("le bonus ne se facture pas mais son coût ampute la marge", () => {
    // 10 payés + 2 offerts, achetés 700 l'unité, vendus 1000.
    const totals = computeDocTotals(
      [line({ quantity: 10, unitPriceHT: 1000, tvaRate: 0, purchaseCostPUMP: 700, quantiteBonus: 2 })],
      0,
      'CHEQUE'
    );

    // Le client paie 10 unités, pas 12.
    expect(totals.totalHT).toBe(10000);
    // Mais 12 unités ont été achetées: 12 × 700 = 8400.
    expect(totals.marginHT).toBe(1600);
    // Sans prise en compte du bonus la marge afficherait 3000 — soit près du
    // double. C'est exactement l'erreur qui fait vendre à perte sans le voir.
    expect(totals.marginHT).toBeLessThan(3000);
  });

  it('un bonus sans vente donne une marge négative égale au coût donné', () => {
    const totals = computeDocTotals(
      [line({ quantity: 0, unitPriceHT: 1000, tvaRate: 0, purchaseCostPUMP: 700, quantiteBonus: 3 })],
      0,
      'CHEQUE'
    );
    expect(totals.totalHT).toBe(0);
    expect(totals.marginHT).toBe(-2100);
  });

  it('la ristourne se retranche après la remise, et réduit la TVA', () => {
    const totals = computeDocTotals(
      [line({ quantity: 1, unitPriceHT: 1000, discountPercent: 10, tvaRate: 19, ristourne: 100 })],
      0,
      'CHEQUE'
    );
    // 1000 → -10 % = 900 → -100 de ristourne = 800
    expect(totals.totalHT).toBeCloseTo(800, 6);
    expect(totals.totalTVA).toBeCloseTo(152, 6);
  });

  it('une ristourne excessive ne rend pas la ligne négative', () => {
    // Une ligne négative rembourserait le client au milieu d'une facture, et
    // fausserait la TVA collectée.
    const totals = computeDocTotals(
      [line({ quantity: 1, unitPriceHT: 100, tvaRate: 19, ristourne: 500 })],
      0,
      'CHEQUE'
    );
    expect(totals.totalHT).toBe(0);
    expect(totals.totalTVA).toBe(0);
  });

  it('bonus et ristourne sont sans effet quand ils ne sont pas renseignés', () => {
    // Les documents existants n'ont ni l'un ni l'autre: leurs totaux ne doivent
    // pas bouger d'un centime.
    const avec = computeDocTotals([line({ quantity: 2, unitPriceHT: 500, tvaRate: 19, purchaseCostPUMP: 300 })], 0, 'ESPECE');
    const explicite = computeDocTotals(
      [line({ quantity: 2, unitPriceHT: 500, tvaRate: 19, purchaseCostPUMP: 300, quantiteBonus: 0, ristourne: 0 })],
      0,
      'ESPECE'
    );
    expect(avec).toEqual(explicite);
  });
});

describe('quantiteDepuisColis', () => {
  it('multiplie le nombre de colis par le colisage de l’article', () => {
    expect(quantiteDepuisColis(3, 12)).toBe(36);
  });

  it('retombe sur 1 unité par colis quand le colisage est absent ou nul', () => {
    // Sinon la marchandise sortirait du stock en quantité nulle: on livrerait
    // sans jamais décrémenter.
    expect(quantiteDepuisColis(5, null)).toBe(5);
    expect(quantiteDepuisColis(5, 0)).toBe(5);
    expect(quantiteDepuisColis(5, undefined)).toBe(5);
  });

  it('ignore un nombre de colis négatif ou fractionnaire', () => {
    expect(quantiteDepuisColis(-2, 10)).toBe(0);
    expect(quantiteDepuisColis(2.7, 10)).toBe(20);
  });
});

describe('evaluatePartnerBlocking', () => {
  const REF = new Date('2026-01-01T00:00:00Z');
  const NOW = new Date('2026-03-01T00:00:00Z'); // 59 jours apres la reference

  function partner(over: Partial<Parameters<typeof evaluatePartnerBlocking>[0]> = {}) {
    return {
      balance: 0,
      seuilAutorise: 0,
      blocageActif: true,
      blocageDateReference: REF,
      blocageJours: 30,
      ...over
    };
  }

  it('ne bloque jamais un partenaire dont le blocage est desactive', () => {
    const r = evaluatePartnerBlocking(partner({ blocageActif: false, balance: 999999, seuilAutorise: 10 }), NOW);
    expect(r.blocked).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it('bloque sur le montant quand le solde depasse le seuil', () => {
    const r = evaluatePartnerBlocking(partner({ balance: 15000, seuilAutorise: 10000, blocageJours: null }), NOW);
    expect(r.blocked).toBe(true);
    expect(r.reasons).toEqual(['MONTANT']);
  });

  it('ne bloque pas quand le solde reste sous le seuil', () => {
    const r = evaluatePartnerBlocking(partner({ balance: 9000, seuilAutorise: 10000, blocageJours: null }), NOW);
    expect(r.blocked).toBe(false);
  });

  it('un seuil a zero signifie "pas de plafond", pas "tout bloque"', () => {
    // Regression: inverser cette convention bloquerait tous les clients en caisse.
    const r = evaluatePartnerBlocking(partner({ balance: 500000, seuilAutorise: 0, blocageJours: null }), NOW);
    expect(r.blocked).toBe(false);
  });

  it('bloque sur l anciennete quand la dette depasse le nombre de jours', () => {
    const r = evaluatePartnerBlocking(partner({ balance: 100, seuilAutorise: 0, blocageJours: 30 }), NOW);
    expect(r.blocked).toBe(true);
    expect(r.reasons).toEqual(['ANCIENNETE']);
    expect(r.joursEcoules).toBe(59);
  });

  it('ne bloque pas sur l anciennete tant que le delai n est pas depasse', () => {
    const r = evaluatePartnerBlocking(partner({ balance: 100, seuilAutorise: 0, blocageJours: 90 }), NOW);
    expect(r.blocked).toBe(false);
  });

  it('cumule les deux motifs quand ils sont reunis', () => {
    const r = evaluatePartnerBlocking(partner({ balance: 15000, seuilAutorise: 10000, blocageJours: 30 }), NOW);
    expect(r.blocked).toBe(true);
    expect(r.reasons).toEqual(['MONTANT', 'ANCIENNETE']);
  });

  it('un solde nul ou crediteur ne bloque jamais, meme tres ancien', () => {
    expect(evaluatePartnerBlocking(partner({ balance: 0, blocageJours: 1 }), NOW).blocked).toBe(false);
    expect(evaluatePartnerBlocking(partner({ balance: -5000, blocageJours: 1 }), NOW).blocked).toBe(false);
  });

  it('sans date de reference, seul le montant peut bloquer', () => {
    const r = evaluatePartnerBlocking(partner({ balance: 100, blocageDateReference: null, blocageJours: 1 }), NOW);
    expect(r.blocked).toBe(false);
    expect(r.joursEcoules).toBeNull();
  });
});
