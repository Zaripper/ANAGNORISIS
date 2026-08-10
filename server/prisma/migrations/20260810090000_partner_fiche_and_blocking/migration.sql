-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "blocageActif" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "blocageDateReference" TIMESTAMP(3),
ADD COLUMN     "blocageJours" INTEGER,
ADD COLUMN     "codePostal" TEXT,
ADD COLUMN     "contact" TEXT,
ADD COLUMN     "fax" TEXT,
ADD COLUMN     "mobile" TEXT,
ADD COLUMN     "pays" TEXT,
ADD COLUMN     "peutAvoirRefaction" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "siteInternet" TEXT,
ADD COLUMN     "ville" TEXT;

