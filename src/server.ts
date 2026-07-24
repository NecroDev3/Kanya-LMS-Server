import dotenv from 'dotenv';
dotenv.config();

import { validateEnv } from './config/env.js';

const PORT = process.env.PORT || 3001;

// Populated after the environment is validated (see startServer).
let close: () => Promise<void> = async () => {};

async function startServer(): Promise<void> {
  try {
    // Fail fast on a misconfigured environment before importing app/db (whose module
    // side effects assume valid config) or binding a port.
    validateEnv();

    const [{ default: app }, dbModule] = await Promise.all([
      import('./app.js'),
      import('./config/database.js'),
    ]);
    close = dbModule.close;

    await dbModule.testConnection();
    console.log('✅ Database connected successfully');

    app.listen(PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${PORT}`);
      console.log(`📚 API base URL: http://localhost:${PORT}/api/v1`);
      console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️  Unhandled rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught exception:', error);
  void close().finally(() => process.exit(1));
});

// Graceful shutdown
async function shutdown(): Promise<void> {
  console.log('\n🛑 Shutting down gracefully...');
  await close();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});

void startServer();
