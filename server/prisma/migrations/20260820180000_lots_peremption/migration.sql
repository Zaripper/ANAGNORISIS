-- Suivi par lot et date de peremption.
--
-- Le suivi est optionnel article par article (Article.suiviLot, defaut false):
-- le catalogue existant n'a aucun lot enregistre, et exiger une allocation de
-- lot sur chaque vente bloquerait immediatement toute l'activite.
--
-- Les lots ne sont pas une verite parallele au stock: "ArticleStock" reste le
-- total qui fait foi, "Lot" en est la ventilation.

ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "suiviLot" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "DocumentLine" ADD COLUMN IF NOT EXISTS "numeroLot" TEXT;
ALTER TABLE "DocumentLine" ADD COLUMN IF NOT EXISTS "datePeremption" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "Lot" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "depotId" TEXT NOT NULL,
    "numeroLot" TEXT NOT NULL,
    "datePeremption" TIMESTAMP(3) NOT NULL,
    "qtyInStock" INTEGER NOT NULL DEFAULT 0,
    "qtyReserved" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Lot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DocumentLineLot" (
    "id" TEXT NOT NULL,
    "documentLineId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    CONSTRAINT "DocumentLineLot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Lot_articleId_depotId_numeroLot_datePeremption_key"
    ON "Lot"("articleId", "depotId", "numeroLot", "datePeremption");
CREATE INDEX IF NOT EXISTS "Lot_datePeremption_idx" ON "Lot"("datePeremption");
CREATE INDEX IF NOT EXISTS "Lot_articleId_depotId_idx" ON "Lot"("articleId", "depotId");
CREATE INDEX IF NOT EXISTS "DocumentLineLot_documentLineId_idx" ON "DocumentLineLot"("documentLineId");
CREATE INDEX IF NOT EXISTS "DocumentLineLot_lotId_idx" ON "DocumentLineLot"("lotId");

ALTER TABLE "Lot" DROP CONSTRAINT IF EXISTS "Lot_articleId_fkey";
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Lot" DROP CONSTRAINT IF EXISTS "Lot_depotId_fkey";
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_depotId_fkey"
    FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentLineLot" DROP CONSTRAINT IF EXISTS "DocumentLineLot_documentLineId_fkey";
ALTER TABLE "DocumentLineLot" ADD CONSTRAINT "DocumentLineLot_documentLineId_fkey"
    FOREIGN KEY ("documentLineId") REFERENCES "DocumentLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentLineLot" DROP CONSTRAINT IF EXISTS "DocumentLineLot_lotId_fkey";
ALTER TABLE "DocumentLineLot" ADD CONSTRAINT "DocumentLineLot_lotId_fkey"
    FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
