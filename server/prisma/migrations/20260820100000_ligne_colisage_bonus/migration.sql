-- Lignes de vente au modele du logiciel actuel: emballage (colis/vrac),
-- numero de colis, quantite offerte et ristourne en valeur.
--
-- Les valeurs par defaut reproduisent exactement le comportement actuel
-- (VRAC, aucun bonus, aucune ristourne), donc les documents deja saisis gardent
-- des totaux au centime pres.

CREATE TYPE "Emballage" AS ENUM ('VRAC', 'COLISAGE');

ALTER TABLE "DocumentLine" ADD COLUMN IF NOT EXISTS "emballage" "Emballage" NOT NULL DEFAULT 'VRAC';
ALTER TABLE "DocumentLine" ADD COLUMN IF NOT EXISTS "nbColis" INTEGER;
ALTER TABLE "DocumentLine" ADD COLUMN IF NOT EXISTS "numeroColis" TEXT;
ALTER TABLE "DocumentLine" ADD COLUMN IF NOT EXISTS "quantiteBonus" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DocumentLine" ADD COLUMN IF NOT EXISTS "ristourne" DECIMAL(65,30) NOT NULL DEFAULT 0.0;
