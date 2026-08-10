-- Duree de validite des bons de preparation.
-- Un bon prepare puis oublie immobilisait du stock indefiniment: la reservation
-- ne tombait jamais. On ajoute une date limite figee a la creation et un etat
-- EXPIRE pour les bons echus dont la reservation a ete liberee.

ALTER TYPE "DocumentStatus" ADD VALUE IF NOT EXISTS 'EXPIRE';

ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "dateValidite" TIMESTAMP(3);
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "expiredAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Document_status_dateValidite_idx" ON "Document"("status", "dateValidite");
