import { describe, expect, it } from 'vitest';
import { dansIntervalleDates, enDateInput, exerciceCourant, moisCourant } from './index';

/**
 * Filtrage par période.
 *
 * Deux pièges sont verrouillés ici, et tous deux se manifestent de la même
 * façon pour l'utilisateur — « le filtre ne rend rien »:
 *
 *  - la borne de fin doit couvrir la journée entière, sinon chercher sur un
 *    seul jour ne rend jamais rien;
 *  - la conversion en `YYYY-MM-DD` doit rester locale, sinon un mouvement du
 *    soir bascule au lendemain selon le fuseau.
 */

describe('dansIntervalleDates', () => {
  it('accepte tout quand aucune borne n’est posée', () => {
    expect(dansIntervalleDates('2026-03-12T10:00:00Z')).toBe(true);
  });

  it('la borne de fin couvre la journée entière', () => {
    // Le cas qui casse tout: un document enregistré à 18 h le 12 doit sortir
    // quand on demande « du 12 au 12 ».
    expect(dansIntervalleDates(new Date(2026, 2, 12, 18, 30), '2026-03-12', '2026-03-12')).toBe(true);
    expect(dansIntervalleDates(new Date(2026, 2, 12, 23, 59), '2026-03-12', '2026-03-12')).toBe(true);
  });

  it('la borne de début commence à minuit', () => {
    expect(dansIntervalleDates(new Date(2026, 2, 12, 0, 1), '2026-03-12', null)).toBe(true);
    expect(dansIntervalleDates(new Date(2026, 2, 11, 23, 59), '2026-03-12', null)).toBe(false);
  });

  it('exclut ce qui tombe hors des bornes', () => {
    expect(dansIntervalleDates(new Date(2026, 2, 13), '2026-03-01', '2026-03-12')).toBe(false);
    expect(dansIntervalleDates(new Date(2026, 1, 28), '2026-03-01', '2026-03-12')).toBe(false);
  });

  it('une seule borne ne contraint que son côté', () => {
    expect(dansIntervalleDates(new Date(2026, 5, 1), '2026-03-01', null)).toBe(true);
    expect(dansIntervalleDates(new Date(2026, 0, 1), '2026-03-01', null)).toBe(false);
    expect(dansIntervalleDates(new Date(2026, 0, 1), null, '2026-03-01')).toBe(true);
    expect(dansIntervalleDates(new Date(2026, 5, 1), null, '2026-03-01')).toBe(false);
  });

  it('accepte indifféremment une Date ou une chaîne ISO', () => {
    expect(dansIntervalleDates('2026-03-12T09:00:00.000Z', '2026-03-01', '2026-03-31')).toBe(true);
  });

  it('une valeur absente ne passe que si aucun filtre n’est posé', () => {
    // Sinon une ligne sans date polluerait chaque recherche datée.
    expect(dansIntervalleDates(null)).toBe(true);
    expect(dansIntervalleDates(null, '2026-03-01', null)).toBe(false);
    expect(dansIntervalleDates(undefined, null, '2026-03-01')).toBe(false);
  });

  it('une date illisible est écartée plutôt que de fausser le résultat', () => {
    expect(dansIntervalleDates('pas une date', '2026-03-01', '2026-03-31')).toBe(false);
  });

  it('une borne illisible est ignorée au lieu de tout masquer', () => {
    expect(dansIntervalleDates(new Date(2026, 2, 12), 'n’importe quoi', null)).toBe(true);
  });
});

describe('enDateInput', () => {
  it('reste sur la date locale', () => {
    // 23 h le 12 doit rester le 12, quel que soit le fuseau. `toISOString()`
    // rendrait le 13 à l'est de Greenwich.
    expect(enDateInput(new Date(2026, 2, 12, 23, 30))).toBe('2026-03-12');
    expect(enDateInput(new Date(2026, 0, 1, 0, 15))).toBe('2026-01-01');
  });

  it('complète les mois et jours à deux chiffres', () => {
    expect(enDateInput(new Date(2026, 8, 5))).toBe('2026-09-05');
  });
});

describe('raccourcis de période', () => {
  it('le mois courant va du premier au dernier jour', () => {
    expect(moisCourant(new Date(2026, 2, 17))).toEqual({ du: '2026-03-01', au: '2026-03-31' });
  });

  it('gère février et les mois de 30 jours', () => {
    expect(moisCourant(new Date(2026, 1, 10))).toEqual({ du: '2026-02-01', au: '2026-02-28' });
    expect(moisCourant(new Date(2026, 3, 10))).toEqual({ du: '2026-04-01', au: '2026-04-30' });
  });

  it("l'exercice est l'annee civile, comme confirme par le proprietaire", () => {
    expect(exerciceCourant(new Date(2026, 6, 4))).toEqual({ du: '2026-01-01', au: '2026-12-31' });
  });
});
