-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMINISTRATEUR', 'CAISSIER', 'AGENT');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('ACHAT', 'COMMANDE', 'BON_PREPARATION', 'VENTE', 'FACTURE', 'PROFORMA', 'RETOUR_CLIENT', 'RETOUR_FOURNISSEUR', 'REGULE_PLUS', 'REGULE_MOINS', 'TRANSFERT');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('OUVERT', 'VALIDE', 'ANNULE');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('ESPECE', 'CHEQUE', 'TRAITE', 'VIREMENT');

-- CreateEnum
CREATE TYPE "CashTxType" AS ENUM ('RECETTE', 'DEPENSE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'ADMINISTRATEUR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Livreur" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Livreur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeClass" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargeClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TypeReglement" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TypeReglement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Depot" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Depot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isSupplier" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "raisonSociale" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "zoneId" TEXT,
    "seuilAutorise" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "balance" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "address" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "barcode" TEXT,
    "designation" TEXT NOT NULL,
    "category" TEXT,
    "pump" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "tvaRate" DECIMAL(65,30) NOT NULL DEFAULT 19.0,
    "seuilReappro" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticlePrice" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "priceHT" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "priceTTC" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticlePrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleStock" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "depotId" TEXT NOT NULL,
    "qtyInStock" INTEGER NOT NULL DEFAULT 0,
    "qtyReserved" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "supplierInvoiceNum" TEXT,
    "type" "DocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'OUVERT',
    "partnerId" TEXT,
    "depotId" TEXT NOT NULL,
    "destDepotId" TEXT,
    "livreurId" TEXT,
    "paymentMode" "PaymentMode" NOT NULL DEFAULT 'ESPECE',
    "totalHT" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "remise" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "totalTVA" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "stampDuty" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "totalTTC" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "marginHT" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "marginPercent" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "motif" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "validatedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLine" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "depotId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceHT" DECIMAL(65,30) NOT NULL,
    "discountPercent" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "tvaRate" DECIMAL(65,30) NOT NULL,
    "totalHT" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "totalTTC" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "purchaseCostPUMP" DECIMAL(65,30) NOT NULL DEFAULT 0.0,

    CONSTRAINT "DocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL,
    "chargeClassId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "description" TEXT NOT NULL,
    "paymentMode" "PaymentMode" NOT NULL DEFAULT 'ESPECE',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashTransaction" (
    "id" TEXT NOT NULL,
    "documentId" TEXT,
    "partnerId" TEXT,
    "reference" TEXT,
    "bankName" TEXT,
    "type" "CashTxType" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "paymentMode" "PaymentMode" NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Livreur_code_key" ON "Livreur"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_code_key" ON "Zone"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeClass_code_key" ON "ChargeClass"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TypeReglement_code_key" ON "TypeReglement"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Depot_code_key" ON "Depot"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCategory_code_key" ON "PartnerCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_code_key" ON "Partner"("code");

-- CreateIndex
CREATE INDEX "Partner_categoryId_idx" ON "Partner"("categoryId");

-- CreateIndex
CREATE INDEX "Partner_zoneId_idx" ON "Partner"("zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Article_code_key" ON "Article"("code");

-- CreateIndex
CREATE INDEX "Article_barcode_idx" ON "Article"("barcode");

-- CreateIndex
CREATE INDEX "Article_designation_idx" ON "Article"("designation");

-- CreateIndex
CREATE UNIQUE INDEX "ArticlePrice_articleId_categoryId_key" ON "ArticlePrice"("articleId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleStock_articleId_depotId_key" ON "ArticleStock"("articleId", "depotId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_reference_key" ON "Document"("reference");

-- CreateIndex
CREATE INDEX "Document_partnerId_idx" ON "Document"("partnerId");

-- CreateIndex
CREATE INDEX "Document_livreurId_idx" ON "Document"("livreurId");

-- CreateIndex
CREATE INDEX "Document_type_status_idx" ON "Document"("type", "status");

-- CreateIndex
CREATE INDEX "Document_createdAt_idx" ON "Document"("createdAt");

-- CreateIndex
CREATE INDEX "DocumentLine_documentId_idx" ON "DocumentLine"("documentId");

-- CreateIndex
CREATE INDEX "DocumentLine_articleId_idx" ON "DocumentLine"("articleId");

-- CreateIndex
CREATE INDEX "Charge_chargeClassId_idx" ON "Charge"("chargeClassId");

-- CreateIndex
CREATE INDEX "Charge_documentId_idx" ON "Charge"("documentId");

-- CreateIndex
CREATE INDEX "CashTransaction_createdAt_idx" ON "CashTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "CashTransaction_partnerId_idx" ON "CashTransaction"("partnerId");

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "PartnerCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticlePrice" ADD CONSTRAINT "ArticlePrice_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticlePrice" ADD CONSTRAINT "ArticlePrice_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "PartnerCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleStock" ADD CONSTRAINT "ArticleStock_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleStock" ADD CONSTRAINT "ArticleStock_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_destDepotId_fkey" FOREIGN KEY ("destDepotId") REFERENCES "Depot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_livreurId_fkey" FOREIGN KEY ("livreurId") REFERENCES "Livreur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLine" ADD CONSTRAINT "DocumentLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLine" ADD CONSTRAINT "DocumentLine_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLine" ADD CONSTRAINT "DocumentLine_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_chargeClassId_fkey" FOREIGN KEY ("chargeClassId") REFERENCES "ChargeClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

