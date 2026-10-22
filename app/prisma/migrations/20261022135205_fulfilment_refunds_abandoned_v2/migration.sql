-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "awbNumber" TEXT,
ADD COLUMN     "courier" TEXT,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "razorpayRefundId" TEXT,
ADD COLUMN     "refundReason" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "refundedInPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shipmentStatus" TEXT,
ADD COLUMN     "shippedAt" TIMESTAMP(3),
ADD COLUMN     "trackingUrl" TEXT;

-- CreateTable
CREATE TABLE "AbandonedCheckout" (
    "id" TEXT NOT NULL,
    "razorpayOrderId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "name" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postcode" TEXT,
    "totalInPaise" INTEGER NOT NULL DEFAULT 0,
    "itemsJson" TEXT,
    "recoveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbandonedCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AbandonedCheckout_razorpayOrderId_key" ON "AbandonedCheckout"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "AbandonedCheckout_phone_idx" ON "AbandonedCheckout"("phone");

-- CreateIndex
CREATE INDEX "AbandonedCheckout_createdAt_idx" ON "AbandonedCheckout"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_awbNumber_key" ON "Order"("awbNumber");

