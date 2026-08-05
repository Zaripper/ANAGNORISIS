-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'BON_LIVRAISON';

-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "maxQtyPerClient" INTEGER,
ADD COLUMN     "preferred" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "sourceDocumentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Document_sourceDocumentId_key" ON "Document"("sourceDocumentId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

