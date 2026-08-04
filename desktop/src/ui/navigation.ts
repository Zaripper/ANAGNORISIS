import type { UserRole } from '@anagnorisis/shared';

/**
 * THE screen registry — the single source of truth for application navigation.
 *
 * Why this file exists: menu entries used to be hand-written JSX, each separately
 * wired to a view id. Nothing forced a menu label and its screen to agree, so
 * entries silently drifted (e.g. "Classes de charges" disappeared behind a generic
 * "Données de base" catch-all) and several items pointed at a 🚧 placeholder even
 * though the feature was already built.
 *
 * Now every screen declares itself exactly once here, and the sidebar, the command
 * palette and the role checks are all derived from this list. Adding a screen means
 * adding one entry; it is impossible for navigation to disagree with reality.
 */

export type ScreenId =
  // Fichier — master data
  | 'PARTENAIRES'
  | 'PARTNER_CATEGORIES'
  | 'ARTICLES'
  | 'DEPOTS'
  | 'LIVREURS'
  | 'ZONES'
  | 'CHARGE_CLASSES'
  | 'TYPE_REGLEMENTS'
  // Mouvement — documents
  | 'ACHATS'
  | 'BONS_PREP'
  | 'VENTES_VALIDATION'
  | 'AVOIRS_ACHATS'
  | 'AVOIRS_VENTES'
  | 'REGULES_PLUS'
  | 'REGULES_MOINS'
  | 'TRANSFERTS'
  | 'CHARGES'
  | 'COMMANDES'
  | 'ACHATS_CONSULT'
  | 'VALIDATION_BON_PREP'
  | 'PROFORMA'
  | 'FACTURE'
  // Trésorerie
  | 'CHEQUES_RECETTE'
  | 'CHEQUES_DEPENSE'
  | 'VIREMENT'
  | 'JOURNAL_CAISSE'
  | 'JOURNAL_BANQUE'
  | 'TRANSACTIONS_CAISSIERES'
  // Consultation — stock
  | 'STOCKS'
  | 'PRIX_ARTICLES'
  | 'ETATS_ARTICLES'
  | 'MOUVEMENT_ARTICLE'
  | 'SITUATION'
  | 'REAPPRO'
  // Consultation — partenaires
  | 'SUIVI_PARTENAIRE'
  | 'CREANCES_DETTES'
  | 'CREANCES_A_RECOUVRER'
  | 'PARTENAIRES_BLOQUES'
  // Consultation — analyse
  | 'TABLEAU_BORD'
  | 'CHIFFRE_AFFAIRES'
  | 'CHIFFRE_AFFAIRES_AGENT'
  | 'VENTES_ARTICLES'
  | 'LISTE_BONS_PREP'
  | 'ARCHIVE'
  | 'GRAPHE_INDICES'
  // Consultation — fiscal
  | 'ETAT_104'
  | 'DECLARATION_TVA'
  | 'DECLARATION_TAP'
  | 'ETAT_G50'
  // Outils
  | 'UTILISATEURS'
  | 'PARAMETRES'
  | 'INVENTAIRES'
  | 'SAUVEGARDE'
  | 'ARCHIVAGE'
  | 'MONTANTS_BLOCAGE'
  | 'REORGANISATION_STOCKS'
  | 'AFFICHAGE_TABLES'
  | 'IMPRIMANTE'
  | 'A_PROPOS';

export type ScreenGroup = 'Fichier' | 'Mouvement' | 'Trésorerie' | 'Consultation' | 'Analyse' | 'Fiscal' | 'Outils';

export const SCREEN_GROUPS: ScreenGroup[] = ['Fichier', 'Mouvement', 'Trésorerie', 'Consultation', 'Analyse', 'Fiscal', 'Outils'];

export interface ScreenDef {
  id: ScreenId;
  /** Label shown in the sidebar, command palette and page header. */
  label: string;
  group: ScreenGroup;
  /** Extra words to match on in the command palette (synonyms, old menu names). */
  keywords?: string;
  /**
   * False while the screen is still a placeholder. The sidebar dims these and the
   * palette sorts them last, so nobody clicks into a dead end expecting it to work.
   */
  implemented: boolean;
  /** When set, only these roles see the entry at all. */
  roles?: UserRole[];
}

export const SCREENS: ScreenDef[] = [
  // ---------- Fichier ----------
  { id: 'PARTENAIRES', label: 'Partenaires', group: 'Fichier', keywords: 'clients fournisseurs tiers', implemented: true },
  { id: 'PARTNER_CATEGORIES', label: 'Catégories de partenaires', group: 'Fichier', keywords: 'tarifs tiers categorie', implemented: true },
  { id: 'ARTICLES', label: 'Articles', group: 'Fichier', keywords: 'produits catalogue prix', implemented: true },
  { id: 'DEPOTS', label: 'Dépôts', group: 'Fichier', keywords: 'magasins stockage entrepot', implemented: true },
  { id: 'LIVREURS', label: 'Livreurs', group: 'Fichier', keywords: 'agents chauffeurs livraison', implemented: true },
  { id: 'ZONES', label: 'Zones', group: 'Fichier', keywords: 'secteurs geographique region', implemented: true },
  { id: 'CHARGE_CLASSES', label: 'Classes de charges', group: 'Fichier', keywords: 'depenses frais categories charge', implemented: true },
  { id: 'TYPE_REGLEMENTS', label: 'Types de règlement', group: 'Fichier', keywords: 'paiement conditions regles', implemented: true },

  // ---------- Mouvement ----------
  { id: 'ACHATS', label: 'Saisie des achats', group: 'Mouvement', keywords: 'approvisionnement fournisseur entree', implemented: true },
  { id: 'BONS_PREP', label: 'Bons de préparation', group: 'Mouvement', keywords: 'commande client preparation bp', implemented: true },
  { id: 'VENTES_VALIDATION', label: 'Ventes', group: 'Mouvement', keywords: 'facturation sortie', implemented: true },
  { id: 'AVOIRS_ACHATS', label: 'Avoirs achats', group: 'Mouvement', keywords: 'retour fournisseur', implemented: true },
  { id: 'AVOIRS_VENTES', label: 'Avoirs ventes', group: 'Mouvement', keywords: 'retour client', implemented: true },
  { id: 'REGULES_PLUS', label: 'Régules plus', group: 'Mouvement', keywords: 'correction stock entree ajustement', implemented: true },
  { id: 'REGULES_MOINS', label: 'Régules moins', group: 'Mouvement', keywords: 'correction stock sortie ajustement', implemented: true },
  { id: 'TRANSFERTS', label: 'Transferts inter-dépôts', group: 'Mouvement', keywords: 'mouvement depot', implemented: true },
  { id: 'COMMANDES', label: 'Commandes', group: 'Mouvement', keywords: 'commande fournisseur reception', implemented: false },
  { id: 'ACHATS_CONSULT', label: 'Consultation des achats', group: 'Mouvement', keywords: 'liste achats historique', implemented: false },
  { id: 'VALIDATION_BON_PREP', label: 'Validation bons de préparation', group: 'Mouvement', keywords: 'file attente valider bp', implemented: false },
  { id: 'PROFORMA', label: 'Proforma', group: 'Mouvement', keywords: 'devis estimation', implemented: false },
  { id: 'FACTURE', label: 'Facture', group: 'Mouvement', keywords: 'facturation client', implemented: false },
  { id: 'CHARGES', label: 'Charges', group: 'Mouvement', keywords: 'depenses frais generaux', implemented: false },

  // ---------- Trésorerie ----------
  { id: 'CHEQUES_RECETTE', label: 'Chèques reçus', group: 'Trésorerie', keywords: 'encaissement cheque recette', implemented: true },
  { id: 'CHEQUES_DEPENSE', label: 'Chèques émis', group: 'Trésorerie', keywords: 'decaissement cheque depense', implemented: true },
  { id: 'VIREMENT', label: 'Virements et versements', group: 'Trésorerie', keywords: 'banque transfert', implemented: true },
  { id: 'JOURNAL_CAISSE', label: 'Journal de caisse', group: 'Trésorerie', keywords: 'especes cash', implemented: true },
  { id: 'JOURNAL_BANQUE', label: 'Journal de banque', group: 'Trésorerie', keywords: 'bancaire releve', implemented: true },
  { id: 'TRANSACTIONS_CAISSIERES', label: 'Transactions caissières', group: 'Trésorerie', keywords: 'toutes operations', implemented: true },

  // ---------- Consultation (stock & partenaires) ----------
  { id: 'STOCKS', label: 'Stocks', group: 'Consultation', keywords: 'quantites disponible depot', implemented: true },
  { id: 'PRIX_ARTICLES', label: "Prix d'articles", group: 'Consultation', keywords: 'tarifs grille prix', implemented: true },
  { id: 'ETATS_ARTICLES', label: 'États des articles', group: 'Consultation', keywords: 'inventaire valorisation pump', implemented: true },
  { id: 'MOUVEMENT_ARTICLE', label: "Mouvement d'un article", group: 'Consultation', keywords: 'historique ligne traçabilite', implemented: false },
  { id: 'SITUATION', label: 'Situation', group: 'Consultation', keywords: 'etat general snapshot', implemented: false },
  { id: 'REAPPRO', label: 'Articles à réapprovisionner', group: 'Consultation', keywords: 'rupture seuil commande minimum', implemented: false },
  { id: 'SUIVI_PARTENAIRE', label: "Suivi d'un partenaire", group: 'Consultation', keywords: 'releve compte client historique', implemented: true },
  { id: 'CREANCES_DETTES', label: 'Créances et dettes', group: 'Consultation', keywords: 'balance ages solde', implemented: true },
  { id: 'CREANCES_A_RECOUVRER', label: 'Créances à recouvrer', group: 'Consultation', keywords: 'recouvrement impayes', implemented: true },
  { id: 'PARTENAIRES_BLOQUES', label: 'Partenaires bloqués', group: 'Consultation', keywords: 'credit depasse seuil blocage', implemented: true },
  { id: 'LISTE_BONS_PREP', label: 'Liste des bons de préparation', group: 'Consultation', keywords: 'bp liste', implemented: false },
  { id: 'ARCHIVE', label: "Consultation de l'archive", group: 'Consultation', keywords: 'documents annules anciens', implemented: false },

  // ---------- Analyse ----------
  { id: 'TABLEAU_BORD', label: 'Tableau de bord', group: 'Analyse', keywords: 'kpi indicateurs accueil dashboard', implemented: true },
  { id: 'CHIFFRE_AFFAIRES', label: "Chiffre d'affaires", group: 'Analyse', keywords: 'ca ventes mensuel', implemented: true },
  { id: 'VENTES_ARTICLES', label: "Ventes d'articles", group: 'Analyse', keywords: 'top produits rotation', implemented: true },
  { id: 'CHIFFRE_AFFAIRES_AGENT', label: "Chiffre d'affaires par agent", group: 'Analyse', keywords: 'livreur commercial performance', implemented: false },
  { id: 'GRAPHE_INDICES', label: 'Graphes et indices', group: 'Analyse', keywords: 'evolution courbes statistiques', implemented: false },

  // ---------- Fiscal ----------
  { id: 'ETAT_104', label: 'État 104 et Timbre', group: 'Fiscal', keywords: 'impot timbre fiscal', implemented: false },
  { id: 'DECLARATION_TVA', label: 'Déclaration TVA', group: 'Fiscal', keywords: 'taxe valeur ajoutee', implemented: false },
  { id: 'DECLARATION_TAP', label: 'Déclaration TAP', group: 'Fiscal', keywords: 'taxe activite professionnelle', implemented: false },
  { id: 'ETAT_G50', label: 'État G50', group: 'Fiscal', keywords: 'declaration mensuelle impots', implemented: false },

  // ---------- Outils ----------
  { id: 'UTILISATEURS', label: 'Gestion des utilisateurs', group: 'Outils', keywords: 'comptes roles permissions', implemented: false, roles: ['ADMINISTRATEUR'] },
  { id: 'PARAMETRES', label: 'Paramètres', group: 'Outils', keywords: 'configuration societe reglages', implemented: false, roles: ['ADMINISTRATEUR'] },
  { id: 'INVENTAIRES', label: 'Inventaires', group: 'Outils', keywords: 'comptage physique ecarts', implemented: false },
  { id: 'SAUVEGARDE', label: 'Sauvegarde / Restauration', group: 'Outils', keywords: 'backup restore base donnees', implemented: false, roles: ['ADMINISTRATEUR'] },
  { id: 'ARCHIVAGE', label: 'Archivage des données', group: 'Outils', keywords: 'purge exercice cloture', implemented: false, roles: ['ADMINISTRATEUR'] },
  { id: 'MONTANTS_BLOCAGE', label: 'Calcul des montants de blocage', group: 'Outils', keywords: 'seuil credit recalcul', implemented: false, roles: ['ADMINISTRATEUR'] },
  { id: 'REORGANISATION_STOCKS', label: 'Réorganisation des stocks', group: 'Outils', keywords: 'reorganiser depots', implemented: false, roles: ['ADMINISTRATEUR'] },
  { id: 'AFFICHAGE_TABLES', label: 'Affichage des tables', group: 'Outils', keywords: 'sql brut tables debug', implemented: false, roles: ['ADMINISTRATEUR'] },
  { id: 'IMPRIMANTE', label: 'Impression et modèles', group: 'Outils', keywords: 'imprimer pdf modeles', implemented: false },
  { id: 'A_PROPOS', label: 'À propos', group: 'Outils', keywords: 'version aide info', implemented: true }
];

const BY_ID = new Map(SCREENS.map((s) => [s.id, s]));

export function getScreen(id: ScreenId): ScreenDef | undefined {
  return BY_ID.get(id);
}

/** Screens the given role is allowed to see. */
export function visibleScreens(role: UserRole | undefined): ScreenDef[] {
  return SCREENS.filter((s) => !s.roles || (role && s.roles.includes(role)));
}

/**
 * Fuzzy-ish search for the command palette: matches on label and keywords,
 * accent-insensitively, and ranks implemented screens above placeholders.
 */
export function searchScreens(query: string, role: UserRole | undefined): ScreenDef[] {
  const pool = visibleScreens(role);
  const q = normalize(query.trim());
  if (!q) return pool;

  const terms = q.split(/\s+/);
  return pool
    .map((s) => {
      const haystack = normalize(`${s.label} ${s.keywords ?? ''} ${s.group}`);
      if (!terms.every((t) => haystack.includes(t))) return null;
      const label = normalize(s.label);
      // Prefix matches on the label rank highest, then implemented screens.
      const score = (label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2) + (s.implemented ? 0 : 10);
      return { s, score };
    })
    .filter((x): x is { s: ScreenDef; score: number } => x !== null)
    .sort((a, b) => a.score - b.score || a.s.label.localeCompare(b.s.label))
    .map((x) => x.s);
}

/** Strips accents and lowercases so "depot" matches "Dépôt". */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
}
