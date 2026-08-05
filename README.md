# Anagnorisis ERP — Ets Djemroud

Commercial management system for a parapharmacy distributor (wholesale & retail):
purchasing, stock across multiple depots, sales and preparation slips, treasury,
and partner accounts. Desktop application (Electron + React) over a local
Express/PostgreSQL API, designed for concurrent users on a company LAN.

> **Status: in active development.** 52 of 60 planned screens are implemented
> (the sidebar shows the live count; unbuilt modules are marked *à venir*).
> Earlier revisions of this document claimed "100% feature complete" and
> "0 TypeScript errors"; neither was accurate. This file now tracks reality.

---

## Tech stack

| Layer | Technology |
|---|---|
| Database | PostgreSQL 16+ |
| ORM | Prisma 5 |
| API | Node.js + Express 4 (TypeScript) |
| Frontend | React 18 + Vite 6 + Tailwind 4 |
| Desktop shell | Electron 41 |
| Validation | Zod (shared between client and server) |
| Auth | JWT + bcrypt password hashing |

Monorepo with three npm workspaces:

```
shared/    Zod schemas, enums, and the ledger rules used by BOTH client and server
server/    Express API, Prisma schema, business services
desktop/   Electron + React client
```

---

## Setup

### 1. Prerequisites

- Node.js 18+
- PostgreSQL 16+

```bash
psql -U postgres -c "CREATE DATABASE anagnorisis;"
```

### 2. Environment

Create `.env` in the repository root:

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/anagnorisis
PORT=5000
NODE_ENV=development
CORS_ORIGIN=*
JWT_SECRET=<see below>
JWT_EXPIRES_IN=12h
```

Generate a real `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The server validates its environment at boot and refuses to start on a bad
configuration. In `NODE_ENV=production` it additionally **requires** a strong
`JWT_SECRET` and **rejects** `CORS_ORIGIN=*`.

### 3. Install, migrate, seed

```bash
npm install
npm run db:push
npm run db:seed
```

### 4. Run

```bash
npm run dev
```

Starts the API on `:5000` and the desktop client together.

Default seeded login: `admin` / `admin123` — **change this before any real use.**

---

## Navigation

All screens are declared once in [`desktop/src/ui/navigation.ts`](desktop/src/ui/navigation.ts).
The sidebar, the command palette, and role-based visibility are all derived from
that single registry, so a menu entry cannot drift out of sync with the screen it
opens.

Press <kbd>Ctrl</kbd>+<kbd>K</kbd> to search every screen by name (accent-insensitive:
typing `depot` finds *Dépôts*). Screens not yet built are shown dimmed and marked
*à venir* rather than being hidden or silently opening an empty page.

---

## Module status

Implemented and working against real data:

- **Fichier** — Partenaires, Catégories de partenaires, Articles, Dépôts, Livreurs, Zones, Classes de charges, Types de règlement
- **Mouvement** — **Caisse POS (vente comptoir avec scan code-barres + ticket 80mm)**, Saisie des achats, Commandes fournisseurs (avec réception → achat validé), Bons de préparation, Validation des bons, Ventes, Factures, Proformas, Avoirs achats/ventes, Régules ±, Transferts inter-dépôts, Charges
- **Trésorerie** — Chèques reçus/émis, Virements, Journal de caisse, Journal de banque, Transactions caissières
- **Consultation** — Stocks, Prix d'articles, États des articles, Mouvement d'un article, Articles à réapprovisionner (seuils éditables), Consultation des achats, Liste des bons, Archive, Suivi d'un partenaire, Créances et dettes, Créances à recouvrer, Partenaires bloqués
- **Analyse** — Tableau de bord, Chiffre d'affaires, Chiffre d'affaires par agent, Ventes d'articles
- **Fiscal** — État 104/Timbre, Déclaration TVA, Déclaration TAP, État G50 — *documents de travail pour le comptable, explicitement non contractuels*
- **Outils** — Gestion des utilisateurs (rôles, protection dernier admin), Paramètres (identité société sur les impressions), Inventaire physique (écarts → régules validées)

Printing: every commercial document has an **Imprimer** button (A4 with totals in
French words per Algerian practice); the POS prints an 80mm thermal ticket with
cash received / change due.

Not yet built (visible in the UI, marked *à venir*):

- **Consultation** — Situation
- **Analyse** — Graphes et indices
- **Outils** — Sauvegarde/Restauration, Archivage, Montants de blocage, Réorganisation des stocks, Affichage des tables, Impression (modèles avancés)

> **Note on the Fiscal group.** État 104, TVA, TAP and G50 are real Algerian tax
> filings. The screens here are **working papers to hand to an accountant** — each
> one carries a "document de travail non contractuel" banner on screen and in
> print. Verify every figure before submitting anything to the tax authority.

---

## Business rules

These live in `shared/src/index.ts` so the client and server can never disagree.

**P.U.M.P (weighted average cost)** — recalculated only on a true purchase
(`ACHAT`). Client returns and stock corrections add quantity back without
re-basing the cost, which would otherwise corrupt every future margin figure.

```
PUMP_new = ((qty_old × PUMP_old) + (qty_in × price_in)) / (qty_old + qty_in)
```

**Stock movement** — draft documents never touch physical stock.

- Receiving (`ACHAT`, `RETOUR_CLIENT`, `REGULE_PLUS`) — adds on validation
- Consuming (`BON_PREPARATION`, `VENTE`, `FACTURE`, `RETOUR_FOURNISSEUR`, `REGULE_MOINS`) — reserves on draft, deducts on validation
- `TRANSFERT` — deducts from source depot, adds to destination

**Totals**

```
Total HT   = Σ(qty × unit price HT × (1 − discount%))
Total TVA  = Σ(line HT × TVA rate)
Timbre     = 1% of pre-stamp TTC, cash payments only, clamped to [5, 2500] DZD
Total TTC  = HT − remise + TVA + timbre
Marge HT   = TTC − Σ(qty × PUMP)
```

**Partner balances** — a purchase or sale increases what is owed; a return
decreases it; internal movements and quotes never touch a balance. Whether a
positive balance is a receivable or a payable is decided by the partner
category's `isSupplier` flag.

---

## LAN deployment (server + client stations)

1. **Server machine**: install PostgreSQL + Node, configure `.env` with
   `NODE_ENV=production`, a strong `JWT_SECRET`, and
   `CORS_ORIGIN=http://<client-origin>` (or a comma-separated list). Run the API
   (`npm run build && npm start -w server`). The API listens on `0.0.0.0:5000`.
2. **Client stations**: run the desktop app; on the login screen open
   *Configuration du serveur* and enter `http://<server-ip>:5000`. The address is
   saved locally on that station.
3. **Accounts & roles**: create one account per employee in *Gestion des
   utilisateurs*. ADMINISTRATEUR manages master data, users and settings;
   CAISSIER operates the POS, treasury and document entry; AGENT has read/entry
   access. Write access is enforced by role on the server, not just hidden in
   the UI. The system refuses to demote or deactivate the last active
   administrator.
4. **Barcode scanners**: any keyboard-wedge USB scanner works — the POS scan
   field is always focused and Enter (sent by the scanner) adds the article.

---

## Development

```bash
npm run typecheck     # all three workspaces — currently clean
npm run build
npm run db:generate
```

### Known gaps before production use

These are tracked deliberately rather than hidden:

- **Partial test coverage.** The shared financial core (totals, timbre, ledger
  direction, stock-direction rules) has a vitest suite (`npm test -w shared`);
  the Prisma-backed services (validation, PUMP recalculation) still lack
  integration tests.
- **No Prisma migrations.** The project uses `db:push`. Migrations are needed to
  evolve a live database without data loss.
- **List endpoints are unpaginated.** `GET /articles`, `/documents`, `/partners`
  return every row; this will degrade as data grows.
- **Seeded credentials are weak** and must be rotated before deployment.
- **No backup routine.** Required before this holds real commercial data.

---

## Documentation

- [QUICKSTART.md](QUICKSTART.md) — setup walkthrough
- [VERIFICATION.md](VERIFICATION.md) — post-setup checks
- [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md) — feature audit

> These three predate the current codebase and describe an older schema
> (9 models, 3 document types, enum-based partner categories). The live schema
> has 14 models, 10 document types, and admin-managed partner categories.
