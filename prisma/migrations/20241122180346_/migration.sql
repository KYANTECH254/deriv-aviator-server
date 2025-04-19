-- CreateTable
CREATE TABLE "App" (
    "id" SERIAL NOT NULL,
    "apiKey" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'deriv',
    "deriv_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "permissions" TEXT NOT NULL,
    "connected" INTEGER NOT NULL DEFAULT 0,
    "type" INTEGER NOT NULL DEFAULT 1,
    "max_conn" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "App_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL,
    "token" TEXT NOT NULL,
    "auth_token" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "email" TEXT,
    "appId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Multiplier" (
    "id" SERIAL NOT NULL,
    "value" TEXT,
    "appId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Multiplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bet" (
    "id" SERIAL NOT NULL,
    "round_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "bet_amount" INTEGER NOT NULL,
    "profit" INTEGER NOT NULL,
    "multiplier" TEXT NOT NULL,
    "avatar" TEXT NOT NULL DEFAULT '',
    "username" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "App_apiKey_key" ON "App"("apiKey");

-- CreateIndex
CREATE UNIQUE INDEX "App_platformId_key" ON "App"("platformId");

-- CreateIndex
CREATE UNIQUE INDEX "App_deriv_id_key" ON "App"("deriv_id");

-- CreateIndex
CREATE UNIQUE INDEX "User_token_key" ON "User"("token");

-- CreateIndex
CREATE UNIQUE INDEX "User_auth_token_key" ON "User"("auth_token");

-- CreateIndex
CREATE INDEX "User_appId_idx" ON "User"("appId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("deriv_id") ON DELETE RESTRICT ON UPDATE CASCADE;
