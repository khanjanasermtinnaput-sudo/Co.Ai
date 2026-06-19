// Structured JSON logger for Next.js server components and API routes.
// Works in both the Node.js and Edge runtimes (uses console.log/error).

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  ts:             string;
  level:          LogLevel;
  service:        string;
  msg:            string;
  correlationId?: string;
  requestId?:     string;
  [key: string]:  unknown;
}

const SERVICE = 'coagentix-web';
const DEBUG   = process.env.CGNTX_DEBUG === '1';

function write(
  level:          LogLevel,
  msg:            string,
  fields:         Record<string, unknown> = {},
  correlationId?: string,
): void {
  const entry: LogEntry = {
    ts:      new Date().toISOString(),
    level,
    service: SERVICE,
    msg,
    ...(correlationId ? { correlationId } : {}),
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export interface Logger {
  info:  (msg: string, fields?: Record<string, unknown>) => void;
  warn:  (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, fields?: Record<string, unknown>) => void;
  debug: (msg: string, fields?: Record<string, unknown>) => void;
  child: (bindings: Record<string, unknown>) => Logger;
}

function makeLogger(
  bound:          Record<string, unknown> = {},
  correlationId?: string,
): Logger {
  return {
    info:  (msg, f) => write('info',  msg, { ...bound, ...f }, correlationId),
    warn:  (msg, f) => write('warn',  msg, { ...bound, ...f }, correlationId),
    error: (msg, f) => write('error', msg, { ...bound, ...f }, correlationId),
    debug: (msg, f) => { if (DEBUG) write('debug', msg, { ...bound, ...f }, correlationId); },
    child: (b)      => makeLogger({ ...bound, ...b }, correlationId),
  };
}

/** Module-level logger without a correlation ID (for startup logs etc.) */
export const logger = makeLogger();

/** Creates a request-scoped logger with the correlation ID pre-bound. */
export function requestLogger(req: Request): Logger {
  const correlationId = req.headers.get('x-correlation-id') ?? undefined;
  return makeLogger({}, correlationId);
}
