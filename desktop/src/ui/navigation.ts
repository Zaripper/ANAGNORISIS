import type { UserRole } from '@anagnorisis/shared';
import { FolderOpen, HelpCircle, LayoutDashboard, ScanBarcode, Search, Settings, Wrench, type LucideIcon } from 'lucide-react';

/**
 * THE screen registry — source unique de la navigation.
 *
 * La structure reprend exactement celle du logiciel actuel (M&M Informatique):
 * cinq menus — Fichier, Mouvement, Consultation, Outils, ? — auxquels s'ajoutent
 * l'Accueil et la Caisse. Les libellés et l'ordre des entrées sont ceux du
 * logiciel d'origine, pour que l'équipe retrouve ses repères.
 *
 * Philosophie conservée: tout ce qui ne doit pas être modifiable depuis
 * n'importe où — articles, partenaires, dépôts, zones… — se crée UNIQUEMENT
 * depuis le menu Fichier. Les écrans de Mouvement consomment ces données sans
 * jamais permettre d'en créer.
 */

export type ScreenId =
  // Accueil
  | 'ACCUEIL'
  // Caisse
  | 'CAISSE_POS'
  // Fichier — données de base (seul endroit où l'on crée du référentiel)
  | 'CHARGE_CLASSES'
  | 'PARTNER_CATEGORIES'
  | 'PARTENAIRES'
  | 'ARTICLES'
  | 'DEPOTS'
  | 'TYPE_REGULES'
  | 'LIVREURS'
  | 'ZONES'
  // Mouvement — opérations
  | 'CHARGES'
  | 'ACHATS'
  | 'ACHATS_VALIDATION'
  | 'AVOIRS_ACHATS'
  | 'BONS_PREP'
  | 'VALIDATION_BON_PREP'
  | 'PROFORMA'
  | 'FACTURE'
  | 'BONS_LIVRAISON'
  | 'VENTES_VALIDATION'
  | 'AVOIRS_VENTES'
  | 'REGULES_PLUS'
  | 'REGULES_MOINS'
  | 'TRANSFERTS'
  | 'CHEQUES_RECETTE'
  | 'CHEQUES_DEPENSE'
  | 'VIREMENT'
  | 'SAISIE_CAISSE'
  | 'TRANSACTIONS_CAISSIERES'
  // Consultation — états et analyses
  | 'ETAT_104'
  | 'DECLARATION_TVA'
  | 'ETAT_G50'
  | 'STOCKS'
  | 'PRIX_ARTICLES'
  | 'LOTS'
  | 'MOUVEMENT_ARTICLE'
  | 'SITUATION'
  | 'REAPPRO'
  | 'ETATS_ARTICLES'
  | 'JOURNAL_CAISSE'
  | 'JOURNAL_BANQUE'
  | 'CREANCES_DETTES'
  | 'CREANCES_A_RECOUVRER'
  | 'SUIVI_PARTENAIRE'
  | 'PARTENAIRES_BLOQUES'
  | 'LISTE_BONS_PREP'
  | 'CHIFFRE_AFFAIRES_AGENT'
  | 'CHIFFRE_AFFAIRES'
  | 'VENTES_ARTICLES'
  | 'ARCHIVE'
  | 'TABLEAU_BORD'
  | 'GRAPHE_INDICES'
  // Outils
  | 'PARAMETRES'
  | 'SAUVEGARDE'
  | 'RESTAURATION'
  | 'MODIFICATION'
  | 'AFFICHAGE_TABLES'
  | 'UTILISATEURS'
  | 'INVENTAIRES'
  | 'ARCHIVAGE'
  | 'MONTANTS_BLOCAGE'
  | 'REORGANISATION_STOCKS'
  | 'IMPRIMANTE'
  // ?
  | 'A_PROPOS';

export type ScreenGroup = 'Accueil' | 'Caisse' | 'Fichier' | 'Mouvement' | 'Consultation' | 'Outils' | 'Aide';

/**
 * Ordre du rail, repris du logiciel actuel. 'Accueil' n'y figure pas: il a son
 * propre bouton en tête de rail.
 */
export const SCREEN_GROUPS: ScreenGroup[] = ['Fichier', 'Mouvement', 'Consultation', 'Outils', 'Aide', 'Caisse'];

export const MODULE_META: Record<ScreenGroup, { icon: LucideIcon; hint: string; label?: string }> = {
  Accueil: { icon: LayoutDashboard, hint: "Écran d'accueil" },
  Caisse: { icon: ScanBarcode, hint: 'Vente au comptoir — scan, encaissement, ticket' },
  Fichier: { icon: FolderOpen, hint: 'Données de base: articles, partenaires, dépôts…' },
  Mouvement: { icon: Wrench, hint: 'Achats, ventes, stocks, trésorerie' },
  Consultation: { icon: Search, hint: 'États, journaux, analyses, fiscal' },
  Outils: { icon: Settings, hint: 'Paramètres, utilisateurs, maintenance' },
  Aide: { icon: HelpCircle, hint: 'À propos', label: '?' }
};

export const HOME_SCREEN: ScreenId = 'ACCUEIL';
export const HOME_ICON: LucideIcon = LayoutDashboard;

export interface ScreenDef {
  id: ScreenId;
  label: string;
  group: ScreenGroup;
  /** Synonymes recherchés par la palette (Ctrl+K). */
  keywords?: string;
  /**
   * false tant que l'écran n'est pas construit. L'entrée reste visible — le menu
   * doit refléter le périmètre complet du logiciel actuel — mais elle est
   * estompée et ouvre un écran qui le dit clairement.
   */
  implemented: boolean;
  roles?: UserRole[];
}

export const SCREENS: ScreenDef[] = [
  // ---------- Accueil ----------
  { id: 'ACCUEIL', label: 'Accueil', group: 'Accueil', keywords: 'bienvenue demarrage home', implemented: true },

  // ---------- Caisse ----------
  { id: 'CAISSE_POS', label: 'Vente au comptoir', group: 'Caisse', keywords: 'pos caisse scan code barres ticket detail', implemented: true },

  // ---------- Fichier (ordre du logiciel actuel) ----------
  { id: 'CHARGE_CLASSES', label: 'Classes de charges', group: 'Fichier', keywords: 'nature depenses', implemented: true },
  { id: 'PARTNER_CATEGORIES', label: 'Catégories de partenaires', group: 'Fichier', keywords: 'tarifs paliers categorie', implemented: true },
  { id: 'PARTENAIRES', label: 'Partenaires', group: 'Fichier', keywords: 'clients fournisseurs tiers', implemented: true },
  { id: 'ARTICLES', label: 'Articles', group: 'Fichier', keywords: 'produits catalogue prix', implemented: true },
  { id: 'DEPOTS', label: 'Dépôts', group: 'Fichier', keywords: 'magasins entrepots', implemented: true },
  { id: 'TYPE_REGULES', label: 'Types des régules', group: 'Fichier', keywords: 'motifs regularisation casse perte', implemented: true },
  { id: 'LIVREURS', label: 'Livreurs', group: 'Fichier', keywords: 'agents chauffeurs', implemented: true },
  { id: 'ZONES', label: 'Zones', group: 'Fichier', keywords: 'secteurs geographique', implemented: true },

  // ---------- Mouvement ----------
  { id: 'CHARGES', label: 'Charges', group: 'Mouvement', keywords: 'depenses frais loyer', implemented: true },
  { id: 'ACHATS', label: 'Achats', group: 'Mouvement', keywords: 'saisie achat fournisseur', implemented: true },
  { id: 'ACHATS_VALIDATION', label: 'Saisie et validation des achats', group: 'Mouvement', keywords: 'achat valide immediat file attente', implemented: true },
  { id: 'AVOIRS_ACHATS', label: 'Avoirs achats', group: 'Mouvement', keywords: 'retour fournisseur', implemented: true },
  { id: 'BONS_PREP', label: 'Bons de préparation', group: 'Mouvement', keywords: 'commande client reservation bp', implemented: true },
  { id: 'VALIDATION_BON_PREP', label: 'Validation bon de préparation', group: 'Mouvement', keywords: 'valider file attente', implemented: true },
  { id: 'PROFORMA', label: 'Proforma', group: 'Mouvement', keywords: 'devis estimation', implemented: true },
  { id: 'FACTURE', label: 'Facture', group: 'Mouvement', keywords: 'facturation client', implemented: true },
  { id: 'BONS_LIVRAISON', label: 'Bons de livraison', group: 'Mouvement', keywords: 'bl livraison expedition', implemented: true },
  { id: 'VENTES_VALIDATION', label: 'Ventes', group: 'Mouvement', keywords: 'vente gros sortie', implemented: true },
  { id: 'AVOIRS_VENTES', label: 'Avoirs ventes', group: 'Mouvement', keywords: 'retour client', implemented: true },
  { id: 'REGULES_PLUS', label: 'Régules plus', group: 'Mouvement', keywords: 'correction entree ajustement', implemented: true },
  { id: 'REGULES_MOINS', label: 'Régules moins', group: 'Mouvement', keywords: 'correction sortie casse', implemented: true },
  { id: 'TRANSFERTS', label: 'Transferts inter-dépôts', group: 'Mouvement', keywords: 'mouvement depot', implemented: true },
  { id: 'CHEQUES_RECETTE', label: 'Chèques recette', group: 'Mouvement', keywords: 'encaissement cheque recu', implemented: true },
  { id: 'CHEQUES_DEPENSE', label: 'Chèques dépense', group: 'Mouvement', keywords: 'decaissement cheque emis', implemented: true },
  { id: 'VIREMENT', label: 'Virement ou versement', group: 'Mouvement', keywords: 'banque transfert', implemented: true },
  { id: 'SAISIE_CAISSE', label: 'Saisie de la caisse et validation', group: 'Mouvement', keywords: 'encaissement decaissement especes recu brouillon', implemented: true },
  { id: 'TRANSACTIONS_CAISSIERES', label: 'Transactions caissières', group: 'Mouvement', keywords: 'toutes operations', implemented: true },

  // ---------- Consultation ----------
  { id: 'LOTS', label: 'Lots et péremptions', group: 'Consultation', keywords: 'peremption date lot fefo perime', implemented: true },
  { id: 'ETAT_104', label: 'Etat 104 et Timbre', group: 'Consultation', keywords: 'releve clients annuel nif timbre', implemented: true },
  { id: 'DECLARATION_TVA', label: 'Déclaration de la TVA', group: 'Consultation', keywords: 'taxe valeur ajoutee', implemented: true },
  { id: 'ETAT_G50', label: 'Etat G50', group: 'Consultation', keywords: 'declaration mensuelle', implemented: false },
  { id: 'STOCKS', label: 'Stocks', group: 'Consultation', keywords: 'quantites disponible depot', implemented: true },
  { id: 'PRIX_ARTICLES', label: "Prix d'articles", group: 'Consultation', keywords: 'tarifs grille prix', implemented: true },
  { id: 'MOUVEMENT_ARTICLE', label: "Mouvement d'un article", group: 'Consultation', keywords: 'historique tracabilite', implemented: true },
  { id: 'SITUATION', label: 'Situation', group: 'Consultation', keywords: 'synthese valorisation', implemented: true },
  { id: 'REAPPRO', label: 'Articles à réapprovisionner', group: 'Consultation', keywords: 'rupture seuil alerte', implemented: true },
  { id: 'ETATS_ARTICLES', label: 'Etats des articles', group: 'Consultation', keywords: 'inventaire valorisation pump', implemented: true },
  { id: 'JOURNAL_CAISSE', label: 'Journal de caisse', group: 'Consultation', keywords: 'especes', implemented: true },
  { id: 'JOURNAL_BANQUE', label: 'Journal de banque', group: 'Consultation', keywords: 'bancaire releve', implemented: true },
  { id: 'CREANCES_DETTES', label: 'Créances et dettes', group: 'Consultation', keywords: 'balance soldes', implemented: true },
  { id: 'CREANCES_A_RECOUVRER', label: 'Créances à recouvrer', group: 'Consultation', keywords: 'recouvrement impayes', implemented: true },
  { id: 'SUIVI_PARTENAIRE', label: "Suivi d'un partenaire", group: 'Consultation', keywords: 'releve compte historique', implemented: true },
  { id: 'PARTENAIRES_BLOQUES', label: 'Liste des partenaires bloqués', group: 'Consultation', keywords: 'credit depasse seuil', implemented: true },
  { id: 'LISTE_BONS_PREP', label: 'Liste des bons de préparations', group: 'Consultation', keywords: 'bp historique', implemented: true },
  { id: 'CHIFFRE_AFFAIRES_AGENT', label: "Chiffre d'affaires par agent", group: 'Consultation', keywords: 'livreur commercial', implemented: true },
  { id: 'CHIFFRE_AFFAIRES', label: "Chiffres d'affaires", group: 'Consultation', keywords: 'ca mensuel', implemented: true },
  { id: 'VENTES_ARTICLES', label: "Ventes d'articles", group: 'Consultation', keywords: 'top produits rotation', implemented: true },
  { id: 'ARCHIVE', label: "Consultation de l'archive", group: 'Consultation', keywords: 'annules anciens documents', implemented: true },
  { id: 'TABLEAU_BORD', label: 'Tableau de bord', group: 'Consultation', keywords: 'kpi indicateurs', implemented: true },
  { id: 'GRAPHE_INDICES', label: 'Graphe et indices des évaluations', group: 'Consultation', keywords: 'courbes statistiques', implemented: true },

  // ---------- Outils ----------
  { id: 'PARAMETRES', label: 'Paramètres', group: 'Outils', keywords: 'societe entete impression', implemented: true, roles: ['ADMINISTRATEUR'] },
  { id: 'SAUVEGARDE', label: 'Sauvegarder la base de données', group: 'Outils', keywords: 'backup export', implemented: true, roles: ['ADMINISTRATEUR'] },
  { id: 'RESTAURATION', label: 'Restaurer une base de données', group: 'Outils', keywords: 'restore import', implemented: false, roles: ['ADMINISTRATEUR'] },
  { id: 'MODIFICATION', label: 'Modification', group: 'Outils', keywords: 'correction documents', implemented: false, roles: ['ADMINISTRATEUR'] },
  { id: 'AFFICHAGE_TABLES', label: 'Affichage des tables', group: 'Outils', keywords: 'donnees brutes debug', implemented: true, roles: ['ADMINISTRATEUR'] },
  { id: 'UTILISATEURS', label: 'Gestion des Utilisateurs', group: 'Outils', keywords: 'comptes roles', implemented: true, roles: ['ADMINISTRATEUR'] },
  { id: 'INVENTAIRES', label: 'Inventaires', group: 'Outils', keywords: 'comptage ecarts', implemented: true },
  { id: 'ARCHIVAGE', label: 'Archivage des données', group: 'Outils', keywords: 'exercice cloture export', implemented: true, roles: ['ADMINISTRATEUR'] },
  { id: 'MONTANTS_BLOCAGE', label: 'Calcul des montants de blocage', group: 'Outils', keywords: 'seuils credit recalcul', implemented: true, roles: ['ADMINISTRATEUR'] },
  { id: 'REORGANISATION_STOCKS', label: 'Réorganisation des stocks', group: 'Outils', keywords: 'reorganiser depots', implemented: false, roles: ['ADMINISTRATEUR'] },
  { id: 'IMPRIMANTE', label: 'Imprimante', group: 'Outils', keywords: 'impression modeles configuration', implemented: false, roles: ['ADMINISTRATEUR'] },

  // ---------- ? ----------
  { id: 'A_PROPOS', label: 'À propos', group: 'Aide', keywords: 'version aide raccourcis', implemented: true }
];

const BY_ID = new Map(SCREENS.map((s) => [s.id, s]));

export function getScreen(id: ScreenId): ScreenDef | undefined {
  return BY_ID.get(id);
}

export function visibleScreens(role: UserRole | undefined): ScreenDef[] {
  return SCREENS.filter((s) => !s.roles || (role && s.roles.includes(role)));
}

/** Recherche insensible aux accents; les écrans construits passent devant. */
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
      const score = (label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2) + (s.implemented ? 0 : 10);
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
