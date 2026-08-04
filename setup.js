#!/usr/bin/env node

/**
 * Anagnorisis ERP - Setup Automation Script
 * Automates PostgreSQL configuration and database initialization
 * Usage: node setup.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  🏥 Anagnorisis ERP - Setup Wizard');
  console.log('═══════════════════════════════════════════════\n');

  // Step 1: Check Node.js version
  console.log('📋 Step 1: Checking prerequisites...');
  try {
    const nodeVersion = execSync('node --version', { encoding: 'utf-8' }).trim();
    console.log(`   ✅ Node.js ${nodeVersion} detected`);
  } catch (err) {
    console.error('   ❌ Node.js not found. Please install Node.js 18+');
    process.exit(1);
  }

  // Step 2: Check PostgreSQL
  console.log('\n📋 Step 2: Checking PostgreSQL...');
  let hasPostgres = false;
  try {
    execSync('psql --version', { encoding: 'utf-8', stdio: 'pipe' });
    hasPostgres = true;
    console.log('   ✅ PostgreSQL detected');
  } catch (err) {
    console.log('   ⚠️  PostgreSQL not found in PATH');
    console.log('   📌 Please ensure PostgreSQL 16+ is installed');
    console.log('   📌 Download: https://www.postgresql.org/download/windows/');
    hasPostgres = false;
  }

  // Step 3: Get PostgreSQL credentials
  console.log('\n📋 Step 3: PostgreSQL Configuration');
  const pgUser = await question('   PostgreSQL username (default: postgres): ') || 'postgres';
  const pgPassword = await question('   PostgreSQL password: ');
  const pgHost = await question('   PostgreSQL host (default: localhost): ') || 'localhost';
  const pgPort = await question('   PostgreSQL port (default: 5432): ') || '5432';
  const dbName = await question('   Database name (default: anagnorisis): ') || 'anagnorisis';

  // Step 4: Create .env file
  console.log('\n📋 Step 4: Creating environment configuration...');
  const serverDir = path.join(__dirname, 'server');
  const envPath = path.join(serverDir, '.env');
  
  if (fs.existsSync(envPath)) {
    const overwrite = await question('   .env already exists. Overwrite? (y/n): ');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('   ⏭️  Skipping .env creation');
    } else {
      fs.writeFileSync(envPath, generateEnv(pgUser, pgPassword, pgHost, pgPort, dbName));
      console.log('   ✅ Created .env');
    }
  } else {
    fs.writeFileSync(envPath, generateEnv(pgUser, pgPassword, pgHost, pgPort, dbName));
    console.log('   ✅ Created .env');
  }

  // Step 5: Install dependencies
  console.log('\n📋 Step 5: Installing dependencies...');
  try {
    console.log('   ⏳ This may take a minute...');
    execSync('npm install', { stdio: 'inherit', cwd: __dirname });
    console.log('   ✅ Dependencies installed');
  } catch (err) {
    console.error('   ❌ Failed to install dependencies');
    process.exit(1);
  }

  // Step 6: Setup database
  if (hasPostgres) {
    console.log('\n📋 Step 6: Setting up database...');
    
    const runMigration = await question('   Run database migration? (y/n): ');
    if (runMigration.toLowerCase() === 'y') {
      try {
        console.log('   ⏳ Pushing Prisma schema...');
        execSync('npm run db:push', { stdio: 'inherit', cwd: __dirname });
        console.log('   ✅ Schema migrated');

        const runSeed = await question('   Seed database with demo data? (y/n): ');
        if (runSeed.toLowerCase() === 'y') {
          console.log('   ⏳ Seeding demo data...');
          execSync('npm run db:seed', { stdio: 'inherit', cwd: __dirname });
          console.log('   ✅ Database seeded');
        }
      } catch (err) {
        console.error('   ❌ Database setup failed');
        console.error('   Make sure PostgreSQL is running and credentials are correct');
      }
    }
  } else {
    console.log('\n⚠️  PostgreSQL not found. Database setup skipped.');
    console.log('   Once PostgreSQL is running, execute:');
    console.log('   $ npm run db:push');
    console.log('   $ npm run db:seed');
  }

  // Step 7: Verification
  console.log('\n📋 Step 7: Verification');
  const runVerification = await question('   Run verification tests? (y/n): ');
  if (runVerification.toLowerCase() === 'y') {
    console.log('   ⏳ Running TypeScript check...');
    try {
      execSync('npm run typecheck', { stdio: 'inherit', cwd: __dirname });
      console.log('   ✅ TypeScript validation passed');
    } catch (err) {
      console.error('   ❌ TypeScript errors found');
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════');
  console.log('  ✅ Setup Complete!');
  console.log('═══════════════════════════════════════════════\n');
  console.log('🚀 To start the ERP system:\n');
  console.log('   $ npm run dev\n');
  console.log('📋 For detailed setup instructions, see QUICKSTART.md');
  console.log('📋 For verification checklist, see VERIFICATION.md\n');

  rl.close();
}

function generateEnv(user, password, host, port, dbName) {
  return `# Anagnorisis ERP - Database Configuration
# Generated by setup.js on ${new Date().toISOString()}

# PostgreSQL Connection String
DATABASE_URL="postgresql://${user}:${password}@${host}:${port}/${dbName}"

# Server Configuration
PORT=5000
CORS_ORIGIN=*
NODE_ENV=development

# Optional: Enable debug logging
# DEBUG=prisma:*
`;
}

main().catch(console.error);
