import { describe, expect, it } from 'vitest';
import { peutOuvrirEcran } from './index';

/**
 * Droits d'accès aux écrans.
 *
 * Le point qui mérite d'être verrouillé: le rôle prime toujours. Cocher un
 * écran ne doit jamais accorder à un caissier ce que le serveur refusera de
 * toute façon — sinon l'interface promet un droit qui n'existe pas, et l'erreur
 * n'apparaît qu'au moment d'enregistrer.
 */

const ECRAN_LIBRE = { id: 'STOCKS' };
const ECRAN_ADMIN = { id: 'PARAMETRES', roles: ['ADMINISTRATEUR' as const] };

describe('sans droits personnalisés', () => {
  it('le compte suit simplement son rôle', () => {
    expect(peutOuvrirEcran({ role: 'CAISSIER' }, ECRAN_LIBRE)).toBe(true);
    expect(peutOuvrirEcran({ role: 'ADMINISTRATEUR' }, ECRAN_ADMIN)).toBe(true);
  });

  it('un écran réservé reste fermé aux autres rôles', () => {
    expect(peutOuvrirEcran({ role: 'CAISSIER' }, ECRAN_ADMIN)).toBe(false);
  });
});

describe('avec droits personnalisés', () => {
  it("seuls les écrans cochés s'ouvrent", () => {
    const u = { role: 'CAISSIER' as const, accesPersonnalise: true, screenAccess: ['STOCKS'] };
    expect(peutOuvrirEcran(u, ECRAN_LIBRE)).toBe(true);
    expect(peutOuvrirEcran(u, { id: 'CHARGES' })).toBe(false);
  });

  it('une liste vide ferme tout, sans revenir aux droits du rôle', () => {
    // C'est la raison d'être du drapeau: sans lui, retirer le dernier écran
    // rendrait par erreur tous les droits du rôle.
    const u = { role: 'ADMINISTRATEUR' as const, accesPersonnalise: true, screenAccess: [] };
    expect(peutOuvrirEcran(u, ECRAN_LIBRE)).toBe(false);
    expect(peutOuvrirEcran(u, ECRAN_ADMIN)).toBe(false);
  });

  it('cocher un écran ne contourne pas le rôle', () => {
    // Un caissier à qui l'on coche « Paramètres » ne doit pas y entrer: le
    // serveur le refuserait, et l'interface ne doit pas promettre l'inverse.
    const u = { role: 'CAISSIER' as const, accesPersonnalise: true, screenAccess: ['PARAMETRES'] };
    expect(peutOuvrirEcran(u, ECRAN_ADMIN)).toBe(false);
  });

  it('un identifiant inconnu n’ouvre rien', () => {
    const u = { role: 'ADMINISTRATEUR' as const, accesPersonnalise: true, screenAccess: ['ECRAN_QUI_NEXISTE_PAS'] };
    expect(peutOuvrirEcran(u, ECRAN_LIBRE)).toBe(false);
  });
});

describe("l'accueil", () => {
  it("reste ouvert meme quand tout le reste est ferme", () => {
    // Sinon la personne atterrit sur un refus sans aucun moyen d'aller ailleurs:
    // elle est enfermee des la connexion.
    const u = { role: 'CAISSIER' as const, accesPersonnalise: true, screenAccess: [] };
    expect(peutOuvrirEcran(u, { id: 'ACCUEIL' })).toBe(true);
  });
});

describe('cas limites', () => {
  it('aucun utilisateur, aucun accès', () => {
    expect(peutOuvrirEcran(null, ECRAN_LIBRE)).toBe(false);
    expect(peutOuvrirEcran(undefined, ECRAN_LIBRE)).toBe(false);
  });

  it('des droits personnalisés sans liste ferment tout', () => {
    expect(peutOuvrirEcran({ role: 'AGENT', accesPersonnalise: true }, ECRAN_LIBRE)).toBe(false);
  });
});
