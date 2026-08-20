import { describe, expect, it } from 'vitest';
import { LOT_ALERTE_JOURS_DEFAUT, allouerFEFO, lotEtat, parseAlerteJours, type LotDisponible } from './index';

/**
 * Règles de lots et de péremption.
 *
 * Ce qui est verrouillé ici n'est pas de la mécanique mais une obligation
 * métier: on ne sert jamais un lot périmé, et on sert toujours celui qui périme
 * le plus tôt. Une erreur sur l'un ou l'autre se solde par de la marchandise
 * jetée, ou vendue alors qu'elle n'aurait pas dû l'être.
 */

const NOW = new Date('2026-08-20T12:00:00Z');

function jours(n: number): Date {
  const d = new Date(NOW);
  d.setDate(d.getDate() + n);
  return d;
}

function lot(over: Partial<LotDisponible> & { id: string; datePeremption: Date }): LotDisponible {
  return { qtyInStock: 100, qtyReserved: 0, ...over };
}

describe('lotEtat', () => {
  it('un lot dont la date est passée est périmé', () => {
    expect(lotEtat(jours(-1), 90, NOW)).toBe('PERIME');
  });

  it("un lot qui périme aujourd'hui est déjà périmé", () => {
    // Le « à consommer avant » n'est pas une suggestion: le jour même, c'est
    // trop tard.
    expect(lotEtat(NOW, 90, NOW)).toBe('PERIME');
  });

  it('un lot dans la fenêtre d’alerte est signalé sans être bloqué', () => {
    expect(lotEtat(jours(30), 90, NOW)).toBe('ALERTE');
    expect(lotEtat(jours(90), 90, NOW)).toBe('ALERTE');
  });

  it('un lot au-delà de la fenêtre est valide', () => {
    expect(lotEtat(jours(91), 90, NOW)).toBe('BON');
  });
});

describe('parseAlerteJours', () => {
  it('retombe sur 90 jours quand le paramètre est absent ou aberrant', () => {
    expect(parseAlerteJours(null)).toBe(LOT_ALERTE_JOURS_DEFAUT);
    expect(parseAlerteJours('')).toBe(LOT_ALERTE_JOURS_DEFAUT);
    expect(parseAlerteJours('abc')).toBe(LOT_ALERTE_JOURS_DEFAUT);
    expect(parseAlerteJours('-5')).toBe(LOT_ALERTE_JOURS_DEFAUT);
  });

  it('accepte zéro: alerter uniquement sur les périmés est un choix valable', () => {
    expect(parseAlerteJours('0')).toBe(0);
  });
});

describe('allouerFEFO', () => {
  it('sert le lot qui périme le plus tôt en premier', () => {
    const lots = [
      lot({ id: 'tard', datePeremption: jours(300) }),
      lot({ id: 'tot', datePeremption: jours(10) })
    ];

    expect(allouerFEFO(lots, 40, NOW)).toEqual([{ lotId: 'tot', quantity: 40 }]);
  });

  it("l'ordre de péremption prime sur l'ordre d'arrivée", () => {
    // Un lot reçu récemment peut périmer avant un ancien: servir dans l'ordre
    // d'arrivée laisserait le plus urgent pourrir en rayon.
    const lots = [
      lot({ id: 'ancien', datePeremption: jours(200) }),
      lot({ id: 'recent', datePeremption: jours(20) })
    ];

    expect(allouerFEFO(lots, 10, NOW)[0].lotId).toBe('recent');
  });

  it('enchaîne sur le lot suivant quand le premier ne suffit pas', () => {
    const lots = [
      lot({ id: 'a', datePeremption: jours(10), qtyInStock: 60 }),
      lot({ id: 'b', datePeremption: jours(50), qtyInStock: 100 })
    ];

    expect(allouerFEFO(lots, 100, NOW)).toEqual([
      { lotId: 'a', quantity: 60 },
      { lotId: 'b', quantity: 40 }
    ]);
  });

  it('ne sert jamais un lot périmé', () => {
    const lots = [
      lot({ id: 'perime', datePeremption: jours(-1), qtyInStock: 500 }),
      lot({ id: 'bon', datePeremption: jours(100), qtyInStock: 30 })
    ];

    expect(allouerFEFO(lots, 30, NOW)).toEqual([{ lotId: 'bon', quantity: 30 }]);
  });

  it('refuse la vente plutôt que de puiser dans un lot périmé', () => {
    // 500 unités sont physiquement là, mais périmées: la vente doit échouer.
    const lots = [
      lot({ id: 'perime', datePeremption: jours(-1), qtyInStock: 500 }),
      lot({ id: 'bon', datePeremption: jours(100), qtyInStock: 30 })
    ];

    expect(() => allouerFEFO(lots, 40, NOW)).toThrow('LOT_STOCK_INSUFFISANT');
  });

  it('tient compte de ce qui est déjà réservé ailleurs', () => {
    const lots = [
      lot({ id: 'a', datePeremption: jours(10), qtyInStock: 100, qtyReserved: 90 }),
      lot({ id: 'b', datePeremption: jours(50), qtyInStock: 100 })
    ];

    expect(allouerFEFO(lots, 30, NOW)).toEqual([
      { lotId: 'a', quantity: 10 },
      { lotId: 'b', quantity: 20 }
    ]);
  });

  it('ignore un lot entièrement réservé', () => {
    const lots = [
      lot({ id: 'pris', datePeremption: jours(5), qtyInStock: 50, qtyReserved: 50 }),
      lot({ id: 'libre', datePeremption: jours(60), qtyInStock: 50 })
    ];

    expect(allouerFEFO(lots, 20, NOW)).toEqual([{ lotId: 'libre', quantity: 20 }]);
  });

  it('refuse quand le disponible total ne suffit pas', () => {
    const lots = [lot({ id: 'a', datePeremption: jours(10), qtyInStock: 5 })];
    expect(() => allouerFEFO(lots, 10, NOW)).toThrow('LOT_STOCK_INSUFFISANT');
  });

  it('une quantité nulle ne consomme aucun lot', () => {
    const lots = [lot({ id: 'a', datePeremption: jours(10) })];
    expect(allouerFEFO(lots, 0, NOW)).toEqual([]);
  });

  it("n'alloue jamais plus que demandé", () => {
    const lots = [
      lot({ id: 'a', datePeremption: jours(10), qtyInStock: 1000 }),
      lot({ id: 'b', datePeremption: jours(20), qtyInStock: 1000 })
    ];

    const total = allouerFEFO(lots, 7, NOW).reduce((s, a) => s + a.quantity, 0);
    expect(total).toBe(7);
  });
});
