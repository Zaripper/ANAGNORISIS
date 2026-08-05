import type { UserRole } from '@anagnorisis/shared';
import {
  BarChart3,
  Boxes,
  Landmark,
  LayoutDashboard,
  Library,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  type LucideIcon
} from 'lucide-react';

/**
 * THE screen registry — single source of truth for application navigation.
 *
 * Screens are organised into business MODULES (Ventes, Achats, Stock, …), each
 * with at most ~9 screens. The shell renders an icon rail of modules plus a
 * contextual panel listing only the active module's screens — replacing the
 * earlier single flat sidebar of 60 entries, which was unusable at scale.
 *
 * Every entry here is implemented; a screen cannot appear in navigation without
 * a matching view, and vice versa.
 */

export type ScreenId =
  // Ventes
  | 'CAISSE_POS'
  | 'BONS_PREP'
  | 'VENTES_VALIDATION'
  | 'VALIDATION_BON_PREP'
  | 'FACTURE'
  | 'PROFORMA'
  | 'AVOIRS_VENTES'
  | 'LISTE_BONS_PREP'
  // Achats
  | 'ACHATS'
  | 'COMMANDES'
  | 'AVOIRS_ACHATS'
  | 'ACHATS_CONSULT'
  // Stock
  | 'STOCKS'
  | 'ETATS_ARTICLES'
  | 'MOUVEMENT_ARTICLE'
  | 'REAPPRO'
  | 'TRANSFERTS'
  | 'REGULES_PLUS'
  | 'REGULES_MOINS'
  | 'INVENTAIRES'
  | 'SITUATION'
  // Trésorerie
  | 'JOURNAL_CAISSE'
  | 'JOURNAL_BANQUE'
  | 'CHEQUES_RECETTE'
  | 'CHEQUES_DEPENSE'
  | 'VIREMENT'
  | 'TRANSACTIONS_CAISSIERES'
  | 'CHARGES'
  // Partenaires
  | 'PARTENAIRES'
  | 'SUIVI_PARTENAIRE'
  | 'CREANCES_DETTES'
  | 'CREANCES_A_RECOUVRER'
  | 'PARTENAIRES_BLOQUES'
  | 'MONTANTS_BLOCAGE'
  | 'PARTNER_CATEGORIES'
  | 'ZONES'
  // Référentiel
  | 'ARTICLES'
  | 'DEPOTS'
  | 'LIVREURS'
  | 'TYPE_REGLEMENTS'
  | 'CHARGE_CLASSES'
  // Analyse
  | 'TABLEAU_BORD'
  | 'CHIFFRE_AFFAIRES'
  | 'CHIFFRE_AFFAIRES_AGENT'
  | 'VENTES_ARTICLES'
  | 'GRAPHE_INDICES'
  | 'ARCHIVE'
  // Fiscal
  | 'ETAT_104'
  | 'DECLARATION_TVA'
  | 'DECLARATION_TAP'
  | 'ETAT_G50'
  // Réglages
  | 'PARAMETRES'
  | 'UTILISATEURS'
  | 'SAUVEGARDE'
  | 'ARCHIVAGE'
  | 'AFFICHAGE_TABLES'
  | 'A_PROPOS';

export type ScreenGroup =
  | 'Ventes'
  | 'Achats'
  | 'Stock'
  | 'Trésorerie'
  | 'Partenaires'
  | 'Référentiel'
  | 'Analyse'
  | 'Fiscal'
  | 'Réglages';

export const SCREEN_GROUPS: ScreenGroup[] = [
  'Ventes',
  'Achats',
  'Stock',
  'Trésorerie',
  'Partenaires',
  'Référentiel',
  'Analyse',
  'Fiscal',
  'Réglages'
];

/** Icon + hint for each module's rail button. */
export const MODULE_META: Record<ScreenGroup, { icon: LucideIcon; hint: string }> = {
  Ventes: { icon: ShoppingCart, hint: 'Caisse, bons, factures, avoirs clients' },
  Achats: { icon: Truck, hint: 'Achats, commandes fournisseurs, avoirs' },
  Stock: { icon: Boxes, hint: 'Stocks, mouvements, transferts, inventaires' },
  Trésorerie: { icon: Wallet, hint: 'Caisse, banque, chèques, charges' },
  Partenaires: { icon: Users, hint: 'Clients, fournisseurs, créances' },
  Référentiel: { icon: Library, hint: 'Articles, dépôts, livreurs, données de base' },
  Analyse: { icon: BarChart3, hint: 'Tableau de bord, CA, graphes' },
  Fiscal: { icon: Landmark, hint: 'TVA, timbre, TAP, G50 (documents de travail)' },
  Réglages: { icon: Settings, hint: 'Société, utilisateurs, sauvegardes' }
};

/** The dashboard doubles as the app's landing page (Home button on the rail). */
export const HOME_SCREEN: ScreenId = 'TABLEAU_BORD';
export const HOME_ICON: LucideIcon = LayoutDashboard;

export interface ScreenDef {
  id: ScreenId;
  label: string;
  group: ScreenGroup;
  /** Extra words matched by the command palette (synonyms, old menu names). */
  keywords?: string;
  /** When set, only these roles see the entry (server enforces writes regardless). */
  roles?: UserRole[];
}

export const SCREENS: ScreenDef[] = [
  // ---------- Ventes ----------
  { id: 'CAISSE_POS', label: 'Caisse (comptoir)', group: 'Ventes', keywords: 'pos scanner code barres ticket vente detail retail' },
  { id: 'BONS_PREP', label: 'Bons de préparation', group: 'Ventes', keywords: 'commande client preparation bp reservation' },
  { id: 'VENTES_VALIDATION', label: 'Ventes', group: 'Ventes', keywords: 'facturation sortie gros' },
  { id: 'VALIDATION_BON_PREP', label: 'File de validation', group: 'Ventes', keywords: 'valider bons attente queue' },
  { id: 'FACTURE', label: 'Factures', group: 'Ventes', keywords: 'facturation client' },
  { id: 'PROFORMA', label: 'Proformas', group: 'Ventes', keywords: 'devis estimation quote' },
  { id: 'AVOIRS_VENTES', label: 'Avoirs clients', group: 'Ventes', keywords: 'retour client remboursement' },
  { id: 'LISTE_BONS_PREP', label: 'Liste des bons', group: 'Ventes', keywords: 'bp historique' },

  // ---------- Achats ----------
  { id: 'ACHATS', label: 'Saisie des achats', group: 'Achats', keywords: 'approvisionnement fournisseur entree' },
  { id: 'COMMANDES', label: 'Commandes fournisseurs', group: 'Achats', keywords: 'bon commande reception' },
  { id: 'AVOIRS_ACHATS', label: 'Avoirs fournisseurs', group: 'Achats', keywords: 'retour fournisseur' },
  { id: 'ACHATS_CONSULT', label: 'Historique des achats', group: 'Achats', keywords: 'consultation liste achats' },

  // ---------- Stock ----------
  { id: 'STOCKS', label: 'Stocks par dépôt', group: 'Stock', keywords: 'quantites disponible' },
  { id: 'ETATS_ARTICLES', label: 'États des articles', group: 'Stock', keywords: 'inventaire valorisation pump' },
  { id: 'MOUVEMENT_ARTICLE', label: "Mouvement d'un article", group: 'Stock', keywords: 'historique ligne traçabilite ledger' },
  { id: 'REAPPRO', label: 'Réapprovisionnement', group: 'Stock', keywords: 'rupture seuil alerte commander' },
  { id: 'TRANSFERTS', label: 'Transferts inter-dépôts', group: 'Stock', keywords: 'mouvement depot reorganisation' },
  { id: 'REGULES_PLUS', label: 'Régules plus', group: 'Stock', keywords: 'correction entree ajustement' },
  { id: 'REGULES_MOINS', label: 'Régules moins', group: 'Stock', keywords: 'correction sortie ajustement casse' },
  { id: 'INVENTAIRES', label: 'Inventaire physique', group: 'Stock', keywords: 'comptage ecarts' },
  { id: 'SITUATION', label: 'Situation générale', group: 'Stock', keywords: 'snapshot valorisation tresorerie synthese' },

  // ---------- Trésorerie ----------
  { id: 'JOURNAL_CAISSE', label: 'Journal de caisse', group: 'Trésorerie', keywords: 'especes cash' },
  { id: 'JOURNAL_BANQUE', label: 'Journal de banque', group: 'Trésorerie', keywords: 'bancaire releve' },
  { id: 'CHEQUES_RECETTE', label: 'Chèques reçus', group: 'Trésorerie', keywords: 'encaissement' },
  { id: 'CHEQUES_DEPENSE', label: 'Chèques émis', group: 'Trésorerie', keywords: 'decaissement' },
  { id: 'VIREMENT', label: 'Virements & versements', group: 'Trésorerie', keywords: 'banque transfert' },
  { id: 'TRANSACTIONS_CAISSIERES', label: 'Toutes transactions', group: 'Trésorerie', keywords: 'operations caissieres' },
  { id: 'CHARGES', label: 'Charges', group: 'Trésorerie', keywords: 'depenses frais loyer' },

  // ---------- Partenaires ----------
  { id: 'PARTENAIRES', label: 'Partenaires', group: 'Partenaires', keywords: 'clients fournisseurs tiers repertoire' },
  { id: 'SUIVI_PARTENAIRE', label: "Suivi d'un partenaire", group: 'Partenaires', keywords: 'releve compte historique' },
  { id: 'CREANCES_DETTES', label: 'Créances & dettes', group: 'Partenaires', keywords: 'balance soldes' },
  { id: 'CREANCES_A_RECOUVRER', label: 'Créances à recouvrer', group: 'Partenaires', keywords: 'recouvrement impayes relance' },
  { id: 'PARTENAIRES_BLOQUES', label: 'Partenaires bloqués', group: 'Partenaires', keywords: 'credit depasse seuil' },
  { id: 'MONTANTS_BLOCAGE', label: 'Montants de blocage', group: 'Partenaires', keywords: 'seuils autorises credit recalcul' },
  { id: 'PARTNER_CATEGORIES', label: 'Catégories & tarifs', group: 'Partenaires', keywords: 'paliers tarifaires categorie' },
  { id: 'ZONES', label: 'Zones', group: 'Partenaires', keywords: 'secteurs geographique' },

  // ---------- Référentiel ----------
  { id: 'ARTICLES', label: 'Articles & prix', group: 'Référentiel', keywords: 'produits catalogue tarifs prix' },
  { id: 'DEPOTS', label: 'Dépôts', group: 'Référentiel', keywords: 'magasins entrepots' },
  { id: 'LIVREURS', label: 'Livreurs', group: 'Référentiel', keywords: 'agents chauffeurs' },
  { id: 'TYPE_REGLEMENTS', label: 'Types de règlement', group: 'Référentiel', keywords: 'conditions paiement' },
  { id: 'CHARGE_CLASSES', label: 'Classes de charges', group: 'Référentiel', keywords: 'nature depenses' },

  // ---------- Analyse ----------
  { id: 'TABLEAU_BORD', label: 'Tableau de bord', group: 'Analyse', keywords: 'kpi accueil dashboard home' },
  { id: 'CHIFFRE_AFFAIRES', label: "Chiffre d'affaires", group: 'Analyse', keywords: 'ca mensuel ventes' },
  { id: 'CHIFFRE_AFFAIRES_AGENT', label: 'CA par agent', group: 'Analyse', keywords: 'livreur commercial performance' },
  { id: 'VENTES_ARTICLES', label: "Ventes d'articles", group: 'Analyse', keywords: 'top produits rotation palmares' },
  { id: 'GRAPHE_INDICES', label: 'Graphes & indices', group: 'Analyse', keywords: 'courbes evolution statistiques charts' },
  { id: 'ARCHIVE', label: 'Archive des documents', group: 'Analyse', keywords: 'annules valides historique consultation tous types' },

  // ---------- Fiscal ----------
  { id: 'DECLARATION_TVA', label: 'Déclaration TVA', group: 'Fiscal', keywords: 'taxe valeur ajoutee' },
  { id: 'ETAT_104', label: 'État 104 & Timbre', group: 'Fiscal', keywords: 'impot timbre fiscal' },
  { id: 'DECLARATION_TAP', label: 'Déclaration TAP', group: 'Fiscal', keywords: 'taxe activite professionnelle' },
  { id: 'ETAT_G50', label: 'État G50', group: 'Fiscal', keywords: 'declaration mensuelle synthese' },

  // ---------- Réglages ----------
  { id: 'PARAMETRES', label: 'Paramètres société', group: 'Réglages', keywords: 'configuration entete impression', roles: ['ADMINISTRATEUR'] },
  { id: 'UTILISATEURS', label: 'Utilisateurs', group: 'Réglages', keywords: 'comptes roles permissions', roles: ['ADMINISTRATEUR'] },
  { id: 'SAUVEGARDE', label: 'Sauvegarde', group: 'Réglages', keywords: 'backup export base donnees', roles: ['ADMINISTRATEUR'] },
  { id: 'ARCHIVAGE', label: 'Archivage', group: 'Réglages', keywords: 'export exercice annee cloture', roles: ['ADMINISTRATEUR'] },
  { id: 'AFFICHAGE_TABLES', label: 'Tables (avancé)', group: 'Réglages', keywords: 'sql brut donnees debug', roles: ['ADMINISTRATEUR'] },
  { id: 'A_PROPOS', label: 'À propos', group: 'Réglages', keywords: 'version aide raccourcis' }
];

const BY_ID = new Map(SCREENS.map((s) => [s.id, s]));

export function getScreen(id: ScreenId): ScreenDef | undefined {
  return BY_ID.get(id);
}

export function visibleScreens(role: UserRole | undefined): ScreenDef[] {
  return SCREENS.filter((s) => !s.roles || (role && s.roles.includes(role)));
}

/** Accent-insensitive palette search, label-prefix matches first. */
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
      const score = label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2;
      return { s, score };
    })
    .filter((x): x is { s: ScreenDef; score: number } => x !== null)
    .sort((a, b) => a.score - b.score || a.s.label.localeCompare(b.s.label))
    .map((x) => x.s);
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
}
