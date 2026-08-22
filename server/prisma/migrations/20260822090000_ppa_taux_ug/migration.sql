-- Prix public (PPA) et taux d'unites gratuites autorise, par article.
--
-- Reclames par le proprietaire: a la saisie d'un bon, le vendeur doit voir le
-- prix public et la marge d'UG dont il dispose, sans quitter l'ecran.
--
-- Defaut 0 partout: aucun article existant ne change de comportement, et un
-- taux d'UG a 0 signifie simplement "aucune UG prevue", pas "interdit" -- le
-- controle reste indicatif a la saisie.

ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "ppa" DECIMAL(65,30) NOT NULL DEFAULT 0.0;
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "tauxUGAutorise" DECIMAL(65,30) NOT NULL DEFAULT 0.0;
