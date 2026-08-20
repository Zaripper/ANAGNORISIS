-- "Types des regules" devient ce qu'il designe reellement: des motifs de
-- regularisation de stock (casse, perte, ecart d'inventaire), et non des
-- conditions de reglement.
--
-- La table "TypeReglement" est vide en production (verifie avant migration),
-- le renommage ne perd donc aucune donnee. La renommer plutot que d'en creer
-- une seconde evite de laisser dans le schema un nom qui ment sur son contenu.

CREATE TYPE "ReguleSens" AS ENUM ('PLUS', 'MOINS', 'TOUS');

ALTER TABLE "TypeReglement" RENAME TO "TypeRegule";
ALTER INDEX IF EXISTS "TypeReglement_code_key" RENAME TO "TypeRegule_code_key";
ALTER TABLE "TypeRegule" RENAME CONSTRAINT "TypeReglement_pkey" TO "TypeRegule_pkey";

ALTER TABLE "TypeRegule" ADD COLUMN IF NOT EXISTS "sens" "ReguleSens" NOT NULL DEFAULT 'TOUS';

ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "typeReguleId" TEXT;
CREATE INDEX IF NOT EXISTS "Document_typeReguleId_idx" ON "Document"("typeReguleId");

ALTER TABLE "Document" DROP CONSTRAINT IF EXISTS "Document_typeReguleId_fkey";
ALTER TABLE "Document" ADD CONSTRAINT "Document_typeReguleId_fkey"
    FOREIGN KEY ("typeReguleId") REFERENCES "TypeRegule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Motifs de depart. Ce sont ceux qu'une parapharmacie rencontre reellement;
-- la liste reste modifiable depuis Fichier > Types des regules.
INSERT INTO "TypeRegule" ("id", "code", "label", "sens", "active", "createdAt", "updatedAt") VALUES
    (gen_random_uuid(), 'CASSE',      'Casse',                        'MOINS', true, NOW(), NOW()),
    (gen_random_uuid(), 'PERTE',      'Perte',                        'MOINS', true, NOW(), NOW()),
    (gen_random_uuid(), 'VOL',        'Vol',                          'MOINS', true, NOW(), NOW()),
    (gen_random_uuid(), 'PERIME',     'Peremption (destruction)',     'MOINS', true, NOW(), NOW()),
    (gen_random_uuid(), 'ECART_INV',  'Ecart d''inventaire',          'TOUS',  true, NOW(), NOW()),
    (gen_random_uuid(), 'ERREUR',     'Erreur de saisie',             'TOUS',  true, NOW(), NOW()),
    (gen_random_uuid(), 'RETOUR_INT', 'Retour interne',               'PLUS',  true, NOW(), NOW()),
    (gen_random_uuid(), 'DON',        'Don / echantillon recu',       'PLUS',  true, NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;
