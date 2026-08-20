-- Saisie de la caisse avec validation separee.
--
-- Le defaut VALIDE est essentiel: toutes les ecritures existantes, et toutes
-- celles nees d'un document ou d'un cheque, sont deja le reflet d'une operation
-- validee ailleurs. Les basculer en OUVERT les sortirait des soldes du jour au
-- lendemain. Seule la saisie manuelle de caisse part en OUVERT.

CREATE TYPE "CashStatus" AS ENUM ('OUVERT', 'VALIDE', 'ANNULE');

ALTER TABLE "CashTransaction" ADD COLUMN IF NOT EXISTS "status" "CashStatus" NOT NULL DEFAULT 'VALIDE';
ALTER TABLE "CashTransaction" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
ALTER TABLE "CashTransaction" ADD COLUMN IF NOT EXISTS "validatedById" TEXT;
ALTER TABLE "CashTransaction" ADD COLUMN IF NOT EXISTS "validatedAt" TIMESTAMP(3);
ALTER TABLE "CashTransaction" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);

-- Les ecritures deja en base ont ete imputees a leur creation: on horodate leur
-- validation a cette date-la plutot que de laisser le champ vide.
UPDATE "CashTransaction" SET "validatedAt" = "createdAt" WHERE "validatedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "CashTransaction_status_paymentMode_idx" ON "CashTransaction"("status", "paymentMode");
