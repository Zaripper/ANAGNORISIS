-- Droits d'acces ecran par ecran, par utilisateur.
--
-- Reclame par le proprietaire: creer une session puis cocher, ecran par ecran,
-- ce que la personne peut ouvrir.
--
-- `accesPersonnalise` a false partout au depart: tous les comptes existants
-- continuent de suivre les droits de leur role, exactement comme avant. Le
-- drapeau distingue "suit son role" de "on lui a tout retire", que la seule
-- liste vide ne permettrait pas de differencier.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accesPersonnalise" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "screenAccess" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
