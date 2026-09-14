function getTimestamp(): string {
  return new Date().toISOString().replace("T", " ").substring(0, 19);
}

export const logger = {
  info: (msg: string, ...args: any[]) => {
    console.log(`[${getTimestamp()}] [INFO] ${msg}`, ...args);
  },
  debug: (msg: string, ...args: any[]) => {
    console.log(`[${getTimestamp()}] [DEBUG] ${msg}`, ...args);
  },
  warn: (msg: string, ...args: any[]) => {
    console.warn(`[${getTimestamp()}] [WARN] ⚠️ ${msg}`, ...args);
  },
  error: (msg: string, ...args: any[]) => {
    console.error(`[${getTimestamp()}] [ERROR] ❌ ${msg}`, ...args);
  },
};
