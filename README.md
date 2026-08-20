# Anagnorisis ERP — Ets Djemroud

Commercial management system for a parapharmacy distributor (wholesale & retail):
purchasing, stock across multiple depots, sales and preparation slips, treasury,
and partner accounts. Desktop application (Electron + React) over a local
Express/PostgreSQL API, designed for concurrent users on a company LAN.

> **Status: feature-complete against the planned screen list** — every entry in
> the navigation registry has a working screen. Earlier revisions of this
> document claimed completeness prematurely; this file tracks reality.

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

Starts the API on `:5000` and the Vite dev server on `:5173`. Hot reload applies
to both. Open <http://localhost:5173> in any browser — the app is identical
there.

To run the Electron desktop shell as well:

```bash
npm run dev:app
```

**The two are deliberately separate.** The Electron plugin ties Vite's lifetime
to the desktop window: closing the window stops Vite, and the root
`concurrently -k` then stops the API with it. That is fine when you *are* the
desktop app, but it meant an ordinary `npm run dev` gave you a server that died
whenever the window closed — which is wrong for a LAN setup where the server
runs on its own machine. Hence `vite.config.ts` (web only) and
`vite.electron.config.ts` (adds the Electron plugin).

If the UI ever shows work you know is already written, suspect a **stale second
server**: check for leftover `node` processes from an earlier session before
debugging anything else.

```bash
npm run build
```

Builds through `vite.electron.config.ts`, so `dist/` (web assets) and
`dist-electron/` (`main.js`, `preload.js`) are both produced.

Default seeded login: `admin` / `admin123` — **change this before any real use.**
The development database on this machine uses a password that was already
changed; the seed value only applies to a freshly seeded database.

### 5. Live smoke test (optional)

`server/scripts/` holds three scripts that exercise a **running** server against
whatever database it is pointed at:

```bash
npx tsx scripts/diagnostic.ts
```

Read-only. Reconciles every lot-tracked article's stock against the sum of its
lots, flags stock reserved by no open document, and prints partner balances.
Safe to run any time, including on production.

```bash
SMOKE_LIVE=1 npx tsx scripts/smoke-live.ts
SMOKE_LIVE=1 npx tsx scripts/smoke-live-concurrence.ts
```

These **write**. They create `AUDIT-TMP` entities, play full lifecycles
(purchase with lot and free goods, FEFO sale, expired-lot refusal, inter-depot
transfer, régule, cash entry, cheque, prep-slip expiry, concurrent validations,
role enforcement), then delete everything and assert the before/after snapshot
is byte-identical. They refuse to start without `SMOKE_LIVE=1` so they cannot be
launched by accident.

Deleting the test documents reclaims their reference numbers, so no gap is left
in the fiscal numbering.

---

## Navigation

All screens are declared once in [`desktop/src/ui/navigation.ts`](desktop/src/ui/navigation.ts).
The sidebar, the command palette, and role-based visibility are all derived from
that single registry, so a menu entry cannot drift out of sync with the screen it
opens.

The shell is an icon rail of business modules (Ventes, Achats, Stock,
Trésorerie, Partenaires, Référentiel, Analyse, Fiscal, Réglages) with a
contextual panel listing the active module's screens. The dashboard is the
landing page. Press <kbd>Ctrl</kbd>+<kbd>K</kbd> to jump to any screen by name
(accent-insensitive: typing `depot` finds *Dépôts*).

---

## Module status

Implemented and working against real data:

- **Fichier** — Partenaires, Catégories de partenaires, Articles (dont suivi par lot), Dépôts, Livreurs, Zones, Classes de charges, **Types des régules** (motifs de régularisation: casse, perte, écart d'inventaire…)
- **Mouvement** — **Caisse POS (vente comptoir avec scan code-barres + ticket 80mm)**, Saisie des achats, Commandes fournisseurs (avec réception → achat validé), Bons de préparation, Validation des bons, Ventes, Factures, Proformas, Avoirs achats/ventes, Régules ±, Transferts inter-dépôts, Charges
- **Mouvement (suite)** — **Saisie et validation des achats** (file de validation), **Saisie de la caisse et validation** (écriture en brouillon sans effet sur les soldes jusqu'à validation)
- **Trésorerie** — Chèques reçus/émis **avec cycle de vie** (en instance → mis en paiement → payé / annulé), Virements, Journal de caisse, Journal de banque, Transactions caissières
- **Consultation** — **Lots et péremptions** (FEFO, valeur immobilisée dans les lots périmés), Stocks, Prix d'articles, États des articles, Mouvement d'un article, Articles à réapprovisionner (seuils éditables), Consultation des achats, Liste des bons, Archive, Suivi d'un partenaire, Créances et dettes, Créances à recouvrer, Partenaires bloqués
- **Analyse** — Tableau de bord, Chiffre d'affaires, Chiffre d'affaires par agent, Ventes d'articles
- **Fiscal** — État 104/Timbre, Déclaration TVA, Déclaration TAP, État G50 — *documents de travail pour le comptable, explicitement non contractuels*
- **Outils** — Gestion des utilisateurs (rôles, protection dernier admin), Paramètres (identité société sur les impressions), Inventaire physique (écarts → régules validées)

Printing: every commercial document has an **Imprimer** button (A4 with totals in
French words per Algerian practice); the POS prints an 80mm thermal ticket with
cash received / change due.

Not yet built (visible in the UI but dimmed). This list is derived from the
`implemented: false` entries in the navigation registry — if it drifts, the
registry is the truth:

- **Consultation** — État G50
- **Outils** — Restauration d'une base, Modification, Réorganisation des stocks, Imprimante (modèles avancés)

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

### Production readiness

- **Prisma migrations** are in place (`server/prisma/migrations`, baselined with
  `0_init`). Evolve the schema with `npx prisma migrate dev`; deploy with
  `npx prisma migrate deploy`. Do not go back to `db push` on a live database.
- **Backups**: Réglages → Sauvegarde downloads a timestamped logical JSON export
  from any station; Archivage exports one fiscal year. For binary restores,
  schedule the documented `pg_dump` command on the server.
- **Pagination caps**: list endpoints accept `?limit` (≤1000), `?offset`, `?q`
  and are capped server-side.
- **Credential rotation is enforced**: accounts still on a default or
  admin-reset password are forced to choose a new one at login before entering
  the app (the seeded `admin`/`caissier` accounts are flagged).

### Tests

```bash
npm test                 # all workspaces
npm test -w shared       # 20 unit tests: totals, timbre clamping, ledger direction
npm test -w server       # 26 integration tests against a real Postgres schema
```

The server suite runs against your configured database in a dedicated
`erp_test` schema (never `public`), applying the committed migrations first —
so it also proves the migration files can build a database from scratch. It
covers the code paths that move money and stock: reservation lifecycle and
overselling refusal, validation effects per document type, P.U.M.P
recalculation (and the rule that returns/régules must *not* re-base it),
inter-depot transfers, cancellation reversal, purchase-order reception, and
reference sequencing under concurrent writers.

---

## Documentation

- [QUICKSTART.md](QUICKSTART.md) — setup walkthrough
- [VERIFICATION.md](VERIFICATION.md) — post-setup checks
- [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md) — feature audit

> These three predate the current codebase and describe an older schema
> (9 models, 3 document types, enum-based partner categories). The live schema
> has 14 models, 10 document types, and admin-managed partner categories.
