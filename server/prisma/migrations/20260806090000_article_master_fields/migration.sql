-- CreateEnum
CREATE TYPE "PricePolicy" AS ENUM ('PRIX_SAISI', 'TAUX');

-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "colisage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mainSupplierId" TEXT,
ADD COLUMN     "quantiteReappro" INTEGER,
ADD COLUMN     "securite" INTEGER,
ADD COLUMN     "tauxRefaction" DECIMAL(65,30) NOT NULL DEFAULT 0.0;

-- AlterTable
ALTER TABLE "ArticlePrice" ADD COLUMN     "policy" "PricePolicy" NOT NULL DEFAULT 'PRIX_SAISI',
ADD COLUMN     "taux" DECIMAL(65,30) NOT NULL DEFAULT 0.0;

-- CreateIndex
CREATE INDEX "Article_mainSupplierId_idx" ON "Article"("mainSupplierId");

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_mainSupplierId_fkey" FOREIGN KEY ("mainSupplierId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

